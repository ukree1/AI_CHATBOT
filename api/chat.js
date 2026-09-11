/* ========================================
   FABRE AI - VERCEL API
   api/chat.js
======================================== */


/* ========================================
   API HANDLER
======================================== */

export default async function handler(req, res) {

    /* ========================================
       ONLY ALLOW POST
    ======================================== */

    if (req.method !== "POST") {

        return res.status(405).json({
            error: "Method not allowed."
        });
    }


    /* ========================================
       PREVENT UNCAUGHT STREAM CRASHES

       If the client disconnects mid-stream
       (closed tab, dropped network, etc.),
       Node can emit an 'error' event on the
       response object. With no listener, that
       crashes the whole function invocation
       (FUNCTION_INVOCATION_FAILED). This makes
       it a normal, safely-logged event instead.
    ======================================== */

    let clientDisconnected = false;

    res.on("error", (err) => {
        clientDisconnected = true;
        console.warn("Response stream error (likely client disconnect):", err.message);
    });

    req.on("close", () => {
        clientDisconnected = true;
    });


    try {

        /* ========================================
           GET REQUEST DATA
        ======================================== */

        const {
            message,
            previousInteractionId
        } = req.body || {};


        /* ========================================
           VALIDATE MESSAGE
        ======================================== */

        if (
            !message ||
            typeof message !== "string"
        ) {

            return res.status(400).json({
                error: "Message is required."
            });
        }


        /* ========================================
           GEMINI API KEY
        ======================================== */

        const API_KEY =
            process.env.GEMINI_API_KEY;


        if (!API_KEY) {

            console.error(
                "GEMINI_API_KEY is missing. " +
                "Add it in Vercel Project Settings → Environment Variables, " +
                "then redeploy (a local .env file is NOT enough for production)."
            );

            return res.status(500).json({
                error:
                    "Gemini API key is not configured on the server."
            });
        }


        /* ========================================
           GEMINI CONFIG
        ======================================== */

        const MODEL =
            "gemini-3.7-flash";


        const API_URL =
            "https://generativelanguage.googleapis.com/v1beta/interactions";


        /* ========================================
           REQUEST BODY
        ======================================== */

        const requestBody = {

            model: MODEL,

            input: message,

            stream: true,

            system_instruction: `
You are Fabre AI, a helpful AI assistant.

Response rules:
- Be concise and direct.
- Normally answer in 2 to 5 sentences.
- Use short bullet points when useful.
- Avoid unnecessary explanations.
- Do not repeat the user's question.
- Only give detailed answers when the user asks.
- Use simple and clear language.
            `,

            generation_config: {

                max_output_tokens: 500,

                thinking_level: "low"
            }
        };


        /* ========================================
           CONTINUE PREVIOUS CONVERSATION
        ======================================== */

        if (previousInteractionId) {

            requestBody.previous_interaction_id =
                previousInteractionId;
        }


        console.log(
            "Sending request to Gemini..."
        );


        /* ========================================
           GEMINI REQUEST
        ======================================== */

        let response;

        try {

            response = await fetch(
                API_URL,
                {

                    method: "POST",

                    headers: {

                        "Content-Type":
                            "application/json",

                        "x-goog-api-key":
                            API_KEY
                    },

                    body:
                        JSON.stringify(
                            requestBody
                        )
                }
            );

        } catch (fetchError) {

            /* ========================================
               NETWORK / UPSTREAM FAILURE
               (DNS issue, Gemini unreachable, etc.)
            ======================================== */

            console.error(
                "Failed to reach Gemini API:",
                fetchError
            );

            return res.status(502).json({
                error: "Could not reach the Gemini API.",
                details: fetchError.message
            });
        }


        /* ========================================
           GEMINI ERROR
        ======================================== */

        if (!response.ok) {

            const errorText =
                await response.text();


            console.error(
                "Gemini API error:",
                errorText
            );


            return res.status(
                response.status
            ).json({

                error:
                    "Gemini API request failed.",

                details:
                    errorText
            });
        }


        /* ========================================
           CHECK RESPONSE BODY
        ======================================== */

        if (!response.body) {

            return res.status(500).json({

                error:
                    "Gemini did not return a response stream."
            });
        }


        /* ========================================
           STREAM HEADERS
        ======================================== */

        res.statusCode = 200;


        res.setHeader(
            "Content-Type",
            "text/event-stream"
        );


        res.setHeader(
            "Cache-Control",
            "no-cache"
        );


        res.setHeader(
            "Connection",
            "keep-alive"
        );


        res.setHeader(
            "X-Accel-Buffering",
            "no"
        );


        /* ========================================
           READ GEMINI STREAM
        ======================================== */

        const reader =
            response.body.getReader();


        const decoder =
            new TextDecoder("utf-8");


        try {

            while (true) {

                /* ========================================
                   STOP IF CLIENT ALREADY LEFT
                ======================================== */

                if (clientDisconnected || res.writableEnded) {

                    try {
                        await reader.cancel();
                    } catch {
                        // upstream stream already gone, ignore
                    }

                    break;
                }


                const {
                    value,
                    done
                } =
                    await reader.read();


                if (done) {
                    break;
                }


                const chunk =
                    decoder.decode(
                        value,
                        {
                            stream: true
                        }
                    );


                /* ========================================
                   SEND STREAM TO FRONTEND
                   (guarded against write failures)
                ======================================== */

                try {

                    res.write(chunk);

                } catch (writeError) {

                    console.warn(
                        "Write failed (client likely disconnected):",
                        writeError.message
                    );

                    clientDisconnected = true;

                    try {
                        await reader.cancel();
                    } catch {
                        // ignore
                    }

                    break;
                }
            }

        } finally {

            reader.releaseLock();
        }


        /* ========================================
           END RESPONSE
        ======================================== */

        if (!res.writableEnded) {
            res.end();
        }


    } catch (error) {

        console.error(
            "Vercel function error:",
            error
        );


        /* ========================================
           HANDLE ERROR
        ======================================== */

        if (!res.headersSent) {

            return res.status(500).json({

                error:
                    error.message ||
                    "Internal server error."
            });
        }

        if (!res.writableEnded) {
            res.end();
        }
    }
}