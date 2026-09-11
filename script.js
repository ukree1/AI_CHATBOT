/* ========================================
   FABRE AI - script.js (fixed)
======================================== */

/* ========================================
   GEMINI CONFIG
======================================== */

/*
   IMPORTANT:
   Gemini API requests are handled by the
   Vercel serverless function.

   The Gemini API key is NOT stored here.

   Frontend:
   /api/chat

   Backend:
   process.env.GEMINI_API_KEY
*/

const API_URL = "/api/chat";


/* ========================================
   CHAT ELEMENTS
======================================== */

const messagesContainer =
    document.getElementById("messages");

const messageInput =
    document.getElementById("messageInput");

const sendBtn =
    document.getElementById("sendBtn");

const newChatBtn =
    document.getElementById("newChatBtn");

const chatHistory =
    document.getElementById("chatHistory");

const sidebar =
    document.getElementById("sidebar");

const sidebarOverlay =
    document.getElementById("sidebarOverlay");

const menuToggleBtn =
    document.getElementById("menuToggleBtn");

const closeSidebarBtn =
    document.getElementById("closeSidebarBtn");


/* ========================================
   CHAT STATE
======================================== */

let previousInteractionId = null;
let isGenerating = false;
let currentChatId = null;


/* ========================================
   FIREBASE (OPTIONAL — LOADED LAZILY)

   NOTE: The old version of this file used
   static top-level `import` statements for
   Firebase. In an ES module, if a static
   import fails to load (blocked CDN, offline,
   ad-blocker, etc.), the ENTIRE module fails
   silently — which meant the Enter key
   handler, the Send button handler, and the
   particle background never got attached at
   all. That's what caused "Enter acts like
   Shift+Enter" and "particles don't show up".

   Fix: load Firebase dynamically inside a
   try/catch, AFTER the core UI (send button,
   enter key, particles) is already wired up.
   If Firebase fails, you just lose chat
   history — the chatbot itself keeps working.
======================================== */

let db = null;
let firebaseReady = false;

let fbCollection, fbAddDoc, fbDoc, fbSetDoc, fbGetDoc,
    fbServerTimestamp, fbQuery, fbOrderBy, fbGetDocs;

async function initFirebase() {

    try {

        /* ========================================
           FIREBASE CONFIG
        ======================================== */

        const firebaseConfig = {
            apiKey: "YOUR_FIREBASE_API_KEY", // ← replace with your real Web API key
            authDomain: "ai-chat-bot-45c7c.firebaseapp.com",
            projectId: "ai-chat-bot-45c7c",
            storageBucket: "ai-chat-bot-45c7c.firebasestorage.app",
            messagingSenderId: "485108668518",
            appId: "1:485108668518:web:7ce528da41402326aab5a7",
            measurementId: "G-XDTGKLL2PT"
        };

        const [
            { initializeApp },
            firestoreModule
        ] = await Promise.all([
            import("https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js"),
            import("https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js")
        ]);

        const {
            getFirestore,
            collection,
            addDoc,
            doc,
            setDoc,
            getDoc,
            serverTimestamp,
            query,
            orderBy,
            getDocs
        } = firestoreModule;

        const firebaseApp = initializeApp(firebaseConfig);

        db = getFirestore(firebaseApp);

        fbCollection = collection;
        fbAddDoc = addDoc;
        fbDoc = doc;
        fbSetDoc = setDoc;
        fbGetDoc = getDoc;
        fbServerTimestamp = serverTimestamp;
        fbQuery = query;
        fbOrderBy = orderBy;
        fbGetDocs = getDocs;

        firebaseReady = true;

        console.log(
            "Firebase connected:",
            firebaseApp.name
        );

        await loadRecentChats();

    } catch (error) {

        firebaseReady = false;

        console.warn(
            "Firebase failed to load — chat history will not be saved. " +
            "The chatbot itself will still work.",
            error
        );
    }
}


/* ========================================
   CREATE CHAT ID
======================================== */

function createChatId() {
    return crypto.randomUUID();
}


/* ========================================
   CREATE CHAT
======================================== */

async function createNewChatDocument(title = "New Chat") {

    const chatId = createChatId();

    currentChatId = chatId;
    previousInteractionId = null;

    if (!firebaseReady || !db) {
        return chatId;
    }

    try {

        await fbSetDoc(
            fbDoc(db, "chats", chatId),
            {
                title: title,
                createdAt: fbServerTimestamp(),
                updatedAt: fbServerTimestamp(),
                geminiInteractionId: null
            }
        );

        console.log(
            "New chat created:",
            chatId
        );

    } catch (error) {

        console.error(
            "Error creating chat:",
            error
        );
    }

    return chatId;
}


/* ========================================
   UPDATE CHAT
======================================== */

async function updateChatDocument(data) {

    if (!currentChatId || !firebaseReady || !db) {
        return;
    }

    try {

        await fbSetDoc(
            fbDoc(db, "chats", currentChatId),
            data,
            { merge: true }
        );

    } catch (error) {

        console.error(
            "Error updating chat:",
            error
        );
    }
}


/* ========================================
   SAVE MESSAGE
======================================== */

async function saveMessageToFirebase(role, text) {

    if (!firebaseReady || !db) {
        return;
    }

    try {

        if (!currentChatId) {
            await createNewChatDocument();
        }

        await fbAddDoc(
            fbCollection(db, "chats", currentChatId, "messages"),
            {
                role: role,
                text: text,
                timestamp: fbServerTimestamp()
            }
        );

        await updateChatDocument({
            updatedAt: fbServerTimestamp()
        });

        console.log("Message saved to Firebase.");

    } catch (error) {

        console.error(
            "Firebase save error:",
            error
        );
    }
}


/* ========================================
   SAVE GEMINI INTERACTION ID
======================================== */

async function saveInteractionId(id) {

    if (!id || !currentChatId) {
        return;
    }

    previousInteractionId = id;

    if (!firebaseReady || !db) {
        return;
    }

    try {

        await updateChatDocument({
            geminiInteractionId: id,
            updatedAt: fbServerTimestamp()
        });

    } catch (error) {

        console.error(
            "Error saving interaction ID:",
            error
        );
    }
}


/* ========================================
   CREATE CHAT TITLE
======================================== */

function generateChatTitle(message) {

    let title = message.trim();

    if (!title) {
        return "New Chat";
    }

    if (title.length > 35) {
        title = title.substring(0, 35) + "...";
    }

    return title;
}


/* ========================================
   SEND MESSAGE
======================================== */

async function sendMessage() {

    const message = messageInput.value.trim();

    if (!message || isGenerating) {
        return;
    }

    isGenerating = true;
    sendBtn.disabled = true;

    /* ========================================
       CREATE CHAT IF NEEDED
    ======================================== */

    const isFirstMessage = !currentChatId;

    if (!currentChatId) {
        await createNewChatDocument(generateChatTitle(message));
    }

    /* ========================================
       SHOW USER MESSAGE
    ======================================== */

    addMessage("user", message);

    messageInput.value = "";
    messageInput.style.height = "auto";

    await saveMessageToFirebase("user", message);

    /* ========================================
       UPDATE TITLE
    ======================================== */

    if (isFirstMessage) {
        await updateChatDocument({
            title: generateChatTitle(message)
        });
    }

    /* ========================================
       LOADING
    ======================================== */

    const loadingMessage = addLoadingMessage();

    try {

        /* ========================================
           VERCEL API REQUEST
        ======================================== */

        const response = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: message,
                previousInteractionId: previousInteractionId
            })
        });

        /* ========================================
           ERROR HANDLING
        ======================================== */

        if (!response.ok) {

            const errorText = await response.text();
            let errorMessage = "AI request failed.";

            try {
                const errorData = JSON.parse(errorText);
                errorMessage = errorData.error || errorData.details || errorMessage;
            } catch {
                errorMessage = errorText || errorMessage;
            }

            throw new Error(errorMessage);
        }

        /* ========================================
           CHECK STREAM
        ======================================== */

        if (!response.body) {
            throw new Error("Streaming is not supported by this browser.");
        }

        /* ========================================
           REMOVE LOADING
        ======================================== */

        if (loadingMessage && loadingMessage.parentNode) {
            loadingMessage.remove();
        }

        /* ========================================
           CREATE AI MESSAGE
        ======================================== */

        const aiMessageDiv = document.createElement("div");

        aiMessageDiv.classList.add("message", "ai-message");

        aiMessageDiv.innerHTML = `
            <div class="avatar">🤖</div>
            <div class="message-content ai-stream-content">
                <span class="cursor">▌</span>
            </div>
        `;

        messagesContainer.appendChild(aiMessageDiv);

        const aiContent = aiMessageDiv.querySelector(".ai-stream-content");

        /* ========================================
           STREAM READER
        ======================================== */

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");

        let buffer = "";
        let aiResponse = "";

        /* ========================================
           READ STREAM
        ======================================== */

        while (true) {

            const { value, done } = await reader.read();

            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });

            /* ========================================
               SPLIT SSE EVENTS
            ======================================== */

            const events = buffer.split("\n\n");
            buffer = events.pop() || "";

            for (const event of events) {

                const lines = event.split("\n");

                let eventType = "";
                let dataText = "";

                /* ========================================
                   READ SSE LINES
                ======================================== */

                for (const line of lines) {

                    if (line.startsWith("event:")) {
                        eventType = line.slice(6).trim();
                    } else if (line.startsWith("data:")) {
                        dataText += line.slice(5).trim();
                    }
                }

                /* ========================================
                   IGNORE EMPTY EVENTS
                ======================================== */

                if (!dataText || dataText === "[DONE]") {
                    continue;
                }

                /* ========================================
                   PARSE EVENT
                ======================================== */

                let data;

                try {
                    data = JSON.parse(dataText);
                } catch (error) {
                    console.warn("Could not parse SSE data:", dataText);
                    continue;
                }

                /* ========================================
                   INTERACTION CREATED / COMPLETED
                ======================================== */

                if (
                    (eventType === "interaction.created" ||
                     eventType === "interaction.completed") &&
                    data.interaction?.id
                ) {
                    await saveInteractionId(data.interaction.id);
                }

                /* ========================================
                   STREAM TEXT
                ======================================== */

                if (
                    eventType === "step.delta" &&
                    data.delta?.type === "text" &&
                    data.delta.text
                ) {

                    aiResponse += data.delta.text;

                    aiContent.innerHTML =
                        formatAIResponse(aiResponse) +
                        '<span class="cursor">▌</span>';

                    scrollToBottom();
                }

                /* ========================================
                   STREAM ERROR
                ======================================== */

                if (eventType === "error") {
                    throw new Error(
                        data.error?.message || "AI streaming error."
                    );
                }
            }
        }

        /* ========================================
           FINAL RESPONSE
        ======================================== */

        if (!aiResponse.trim()) {
            throw new Error("AI returned an empty response.");
        }

        aiContent.innerHTML = formatAIResponse(aiResponse);

        /* ========================================
           SAVE AI RESPONSE
        ======================================== */

        await saveMessageToFirebase("assistant", aiResponse);

        /* ========================================
           REFRESH RECENT CHATS
        ======================================== */

        await loadRecentChats();

    } catch (error) {

        console.error("AI Error:", error);

        if (loadingMessage && loadingMessage.parentNode) {
            loadingMessage.remove();
        }

        let friendlyError = error.message || "Something went wrong.";

        /* ========================================
           QUOTA ERROR
        ======================================== */

        if (friendlyError.toLowerCase().includes("quota")) {
            friendlyError =
                "⚡ Fabre AI is temporarily unavailable because the Gemini API quota has been reached.";
        }

        addMessage("ai", `❌ ${friendlyError}`);

    } finally {

        isGenerating = false;
        sendBtn.disabled = false;
        messageInput.focus();
    }
}


/* ========================================
   ADD MESSAGE
======================================== */

function addMessage(sender, text) {

    const messageDiv = document.createElement("div");

    messageDiv.classList.add("message");

    /* ========================================
       USER MESSAGE
    ======================================== */

    if (sender === "user") {

        messageDiv.classList.add("user-message");

        messageDiv.innerHTML = `
            <div class="message-content">
                <p>${escapeHTML(text)}</p>
            </div>
            <div class="avatar">👤</div>
        `;

    }

    /* ========================================
       AI MESSAGE
    ======================================== */

    else {

        messageDiv.classList.add("ai-message");

        messageDiv.innerHTML = `
            <div class="avatar">🤖</div>
            <div class="message-content">${formatAIResponse(text)}</div>
        `;
    }

    messagesContainer.appendChild(messageDiv);

    scrollToBottom();
}


/* ========================================
   LOADING MESSAGE
======================================== */

function addLoadingMessage() {

    const messageDiv = document.createElement("div");

    messageDiv.classList.add("message", "ai-message");

    messageDiv.innerHTML = `
        <div class="avatar">🤖</div>
        <div class="message-content typing">AI is thinking...</div>
    `;

    messagesContainer.appendChild(messageDiv);

    scrollToBottom();

    return messageDiv;
}


/* ========================================
   FORMAT AI RESPONSE
======================================== */

function formatAIResponse(text) {

    let formatted = escapeHTML(text);

    /* ========================================
       BOLD
    ======================================== */

    formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

    /* ========================================
       ITALIC
    ======================================== */

    formatted = formatted.replace(/\*(.*?)\*/g, "<em>$1</em>");

    /* ========================================
       INLINE CODE
    ======================================== */

    formatted = formatted.replace(/`([^`]+)`/g, "<code>$1</code>");

    /* ========================================
       NEW LINES
    ======================================== */

    formatted = formatted.replace(/\n/g, "<br>");

    return formatted;
}


/* ========================================
   ESCAPE HTML
======================================== */

function escapeHTML(text) {

    const div = document.createElement("div");

    div.textContent = text;

    return div.innerHTML;
}


/* ========================================
   SCROLL
======================================== */

function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}


/* ========================================
   LOAD RECENT CHATS
======================================== */

async function loadRecentChats() {

    if (!chatHistory || !firebaseReady || !db) {
        return;
    }

    try {

        const chatsRef = fbCollection(db, "chats");

        const chatsQuery = fbQuery(chatsRef, fbOrderBy("updatedAt", "desc"));

        const snapshot = await fbGetDocs(chatsQuery);

        chatHistory.innerHTML = "";

        snapshot.forEach((chatDoc) => {

            const data = chatDoc.data();

            const chatItem = document.createElement("div");

            chatItem.classList.add("chat-history-item");

            chatItem.dataset.chatId = chatDoc.id;

            chatItem.textContent = data.title || "New Chat";

            chatItem.title = data.title || "New Chat";

            chatItem.addEventListener("click", () => {

                if (isGenerating) {
                    return;
                }

                loadChat(chatDoc.id);

                closeSidebarOnMobile();
            });

            chatHistory.appendChild(chatItem);
        });

        if (currentChatId) {
            highlightActiveChat(currentChatId);
        }

        console.log("Recent chats loaded.");

    } catch (error) {

        console.error(
            "Error loading recent chats:",
            error
        );
    }
}


/* ========================================
   LOAD CHAT
======================================== */

async function loadChat(chatId) {

    if (isGenerating || !firebaseReady || !db) {
        return;
    }

    try {

        const chatRef = fbDoc(db, "chats", chatId);

        const chatSnapshot = await fbGetDoc(chatRef);

        if (!chatSnapshot.exists()) {
            console.warn("Chat does not exist.");
            return;
        }

        const chatData = chatSnapshot.data();

        /* ========================================
           RESTORE GEMINI INTERACTION
        ======================================== */

        previousInteractionId = chatData.geminiInteractionId || null;

        currentChatId = chatId;

        /* ========================================
           LOAD MESSAGES
        ======================================== */

        await loadChatMessages(chatId);

        /* ========================================
           HIGHLIGHT ACTIVE CHAT
        ======================================== */

        highlightActiveChat(chatId);

        console.log("Chat loaded:", chatId);

    } catch (error) {

        console.error("Error loading chat:", error);
    }
}


/* ========================================
   LOAD CHAT MESSAGES
======================================== */

async function loadChatMessages(chatId) {

    if (!firebaseReady || !db) {
        return;
    }

    try {

        const messagesRef = fbCollection(db, "chats", chatId, "messages");

        const messagesQuery = fbQuery(messagesRef, fbOrderBy("timestamp", "asc"));

        const snapshot = await fbGetDocs(messagesQuery);

        messagesContainer.innerHTML = "";

        /* ========================================
           EMPTY CHAT
        ======================================== */

        if (snapshot.empty) {

            messagesContainer.innerHTML = `
                <div class="message ai-message">
                    <div class="avatar">🤖</div>
                    <div class="message-content">
                        <p>Hello! 👋 I'm Fabre AI.</p>
                        <p>How can I help you today?</p>
                    </div>
                </div>
            `;

            return;
        }

        /* ========================================
           DISPLAY MESSAGES
        ======================================== */

        snapshot.forEach((messageDoc) => {

            const data = messageDoc.data();

            addMessage(
                data.role === "user" ? "user" : "ai",
                data.text || ""
            );
        });

        scrollToBottom();

    } catch (error) {

        console.error(
            "Error loading chat messages:",
            error
        );
    }
}


/* ========================================
   HIGHLIGHT ACTIVE CHAT
======================================== */

function highlightActiveChat(chatId) {

    if (!chatHistory) {
        return;
    }

    const items = chatHistory.querySelectorAll(".chat-history-item");

    items.forEach((item) => {

        item.classList.remove("active");

        if (item.dataset.chatId === chatId) {
            item.classList.add("active");
        }
    });
}


/* ========================================
   CORE INPUT HANDLERS — ALWAYS ATTACHED
   (never depend on Firebase)
======================================== */

if (messageInput) {

    messageInput.addEventListener("keydown", function (event) {

        /* ========================================
           IGNORE IME COMPOSITION (mobile keyboards,
           Japanese/Chinese/Korean input, etc.) so a
           composition-confirm Enter doesn't send early
        ======================================== */

        if (event.isComposing) {
            return;
        }

        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            sendMessage();
        }
    });

    /* ========================================
       AUTO-GROW TEXTAREA
       So Shift+Enter multi-line input is visible
       instead of hidden by rows="1"
    ======================================== */

    messageInput.addEventListener("input", function () {
        messageInput.style.height = "auto";
        messageInput.style.height =
            Math.min(messageInput.scrollHeight, 140) + "px";
    });
}


/* ========================================
   SEND BUTTON
======================================== */

if (sendBtn) {
    sendBtn.addEventListener("click", sendMessage);
}


/* ========================================
   NEW CHAT
======================================== */

if (newChatBtn) {

    newChatBtn.addEventListener("click", function () {

        if (isGenerating) {
            return;
        }

        previousInteractionId = null;
        currentChatId = null;

        messagesContainer.innerHTML = `
            <div class="message ai-message">
                <div class="avatar">🤖</div>
                <div class="message-content">
                    <p>Hello! 👋 I'm Fabre AI.</p>
                    <p>How can I help you today?</p>
                </div>
            </div>
        `;

        messageInput.value = "";
        messageInput.style.height = "auto";
        messageInput.focus();

        /* ========================================
           REMOVE ACTIVE CHAT
        ======================================== */

        if (chatHistory) {

            const items = chatHistory.querySelectorAll(".chat-history-item");

            items.forEach((item) => {
                item.classList.remove("active");
            });
        }

        closeSidebarOnMobile();
    });
}


/* ========================================
   MOBILE SIDEBAR DRAWER
======================================== */

function openSidebar() {

    if (sidebar) sidebar.classList.add("open");
    if (sidebarOverlay) sidebarOverlay.classList.add("active");
}

function closeSidebar() {

    if (sidebar) sidebar.classList.remove("open");
    if (sidebarOverlay) sidebarOverlay.classList.remove("active");
}

if (menuToggleBtn) {
    menuToggleBtn.addEventListener("click", openSidebar);
}

if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener("click", closeSidebar);
}

if (sidebarOverlay) {
    sidebarOverlay.addEventListener("click", closeSidebar);
}

/* Close the drawer automatically after picking a chat
   or starting a new one, but only on narrow (mobile)
   viewports — on desktop the sidebar is always visible
   so there's nothing to close. */

function closeSidebarOnMobile() {

    if (window.matchMedia("(max-width: 700px)").matches) {
        closeSidebar();
    }
}


/* ========================================
   PARTICLE NETWORK BACKGROUND — ALWAYS RUNS
======================================== */

const canvas = document.getElementById("particleCanvas");

/* ========================================
   CHECK CANVAS
======================================== */

if (canvas) {

    const ctx = canvas.getContext("2d");

    let particles = [];

    /* Fewer particles on small screens — keeps the
       animation smooth on lower-powered mobile GPUs
       and saves battery. */
    const particleCount =
        window.innerWidth <= 700 ? 40 : 90;

    const connectionDistance = 140;

    const mouse = {
        x: null,
        y: null,
        radius: 150
    };

    /* ========================================
       CANVAS SIZE
    ======================================== */

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    resizeCanvas();

    window.addEventListener("resize", resizeCanvas);

    /* ========================================
       MOUSE
    ======================================== */

    window.addEventListener("mousemove", function (event) {
        mouse.x = event.clientX;
        mouse.y = event.clientY;
    });

    window.addEventListener("mouseout", function () {
        mouse.x = null;
        mouse.y = null;
    });

    /* ========================================
       PARTICLE
    ======================================== */

    class Particle {

        constructor() {

            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;

            this.size = Math.random() * 2 + 0.5;

            this.speedX = (Math.random() - 0.5) * 0.5;
            this.speedY = (Math.random() - 0.5) * 0.5;

            this.opacity = Math.random() * 0.7 + 0.2;
        }

        update() {

            this.x += this.speedX;
            this.y += this.speedY;

            /* ========================================
               BOUNCE
            ======================================== */

            if (this.x < 0 || this.x > canvas.width) {
                this.speedX *= -1;
            }

            if (this.y < 0 || this.y > canvas.height) {
                this.speedY *= -1;
            }

            /* ========================================
               MOUSE INTERACTION
            ======================================== */

            if (mouse.x !== null && mouse.y !== null) {

                const dx = this.x - mouse.x;
                const dy = this.y - mouse.y;

                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance > 0 && distance < mouse.radius) {

                    const force = (mouse.radius - distance) / mouse.radius;

                    this.x += (dx / distance) * force * 0.5;
                    this.y += (dy / distance) * force * 0.5;
                }
            }
        }

        draw() {

            ctx.beginPath();

            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);

            ctx.fillStyle = `rgba(168, 85, 247, ${this.opacity})`;

            ctx.shadowBlur = 12;

            ctx.shadowColor = "rgba(168, 85, 247, 0.8)";

            ctx.fill();

            ctx.shadowBlur = 0;
        }
    }

    /* ========================================
       CREATE PARTICLES
    ======================================== */

    function createParticles() {

        particles = [];

        for (let i = 0; i < particleCount; i++) {
            particles.push(new Particle());
        }
    }

    createParticles();

    /* ========================================
       CONNECT PARTICLES
    ======================================== */

    function connectParticles() {

        for (let a = 0; a < particles.length; a++) {

            for (let b = a + 1; b < particles.length; b++) {

                const dx = particles[a].x - particles[b].x;
                const dy = particles[a].y - particles[b].y;

                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < connectionDistance) {

                    const opacity = 1 - distance / connectionDistance;

                    ctx.beginPath();

                    ctx.moveTo(particles[a].x, particles[a].y);
                    ctx.lineTo(particles[b].x, particles[b].y);

                    ctx.strokeStyle = `rgba(168, 85, 247, ${opacity * 0.25})`;

                    ctx.lineWidth = 0.7;

                    ctx.stroke();
                }
            }
        }
    }

    /* ========================================
       ANIMATION
    ======================================== */

    function animateParticles() {

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        particles.forEach((particle) => particle.update());

        connectParticles();

        particles.forEach((particle) => particle.draw());

        requestAnimationFrame(animateParticles);
    }

    animateParticles();
}


/* ========================================
   INITIALIZE (Firebase — non-blocking)
======================================== */

initFirebase();