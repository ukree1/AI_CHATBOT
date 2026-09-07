javascript
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
                "GEMINI_API_KEY is missing."
            );

            return res.status(500).json({
                error:
                    "Gemini API key is not configured."
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

        const response =
            await fetch(
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
                ======================================== */

                res.write(chunk);
            }

        } finally {

            reader.releaseLock();
        }


        /* ========================================
           END RESPONSE
        ======================================== */

        res.end();


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


        res.end();
    }
}
