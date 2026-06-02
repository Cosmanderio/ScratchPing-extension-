// =========================
// Utilitaires
// =========================

function getProjectId() {
    const match =
        location.pathname.match(/\/projects\/(\d+)/) ||
        location.pathname.match(/^\/(\d+)/);

    return match ? match[1] : null;
}

function getProjects() {
    return new Promise(resolve => {
        chrome.storage.local.get("projects", data => {
            resolve(data.projects || []);
        });
    });
}

function setProjects(projects) {
    return new Promise(resolve => {
        chrome.storage.local.set({ projects }, resolve);
    });
}

async function isAlreadyAdded(projectId) {
    const projects = await getProjects();

    return projects.some(
        p => String(p.id) === String(projectId)
    );
}

// Envoi de message sécurisé au background script
async function sendMsg(msg) {
    try {
        return await chrome.runtime.sendMessage(msg);
    } catch (err) {
        console.error("ScratchPing communication error:", err);
        return null;
    }
}

// Convertit un timestamp en temps relatif (ex: "3m ago")
function tempsRelatif(timestamp) {
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60)    return `${diff}s ago`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

// =========================
// Ajout / Suppression de projet
// =========================

async function addProject(projectId) {
    try {
        const projects = await getProjects();

        if (projects.some(p => String(p.id) === String(projectId))) {
            return false;
        }

        const sessionId = await sendMsg({ type: 'GET_SESSION' });
        const info = await sendMsg({ type: 'GET_PROJECT_INFO', projectId, sessionId });

        if (!info) return false;

        const name = info.name
            .replace(/\(.*?\)/g, "")
            .replace(/\[.*?\]/g, "")
            .replace(/#\S+/g, "")
            .replace(/\s*v?\d+(\.\d+)+\s*/gi, "")
            .replace(/\s+(alpha|beta|bêta)\s*$/i, "")
            .replace(/\s+/g, " ")
            .trim();

        projects.push({
            id: Number(projectId),
            name
        });

        await setProjects(projects);
        await sendMsg({ type: 'ENSURE_TW_CONNECTIONS', projectIds: projects.map(p => p.id) });

        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

async function removeProject(projectId) {
    try {
        const projects = await getProjects();
        const filtered = projects.filter(p => String(p.id) !== String(projectId));

        await setProjects(filtered);
        await sendMsg({ type: 'ENSURE_TW_CONNECTIONS', projectIds: filtered.map(p => p.id) });

        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

// =========================
// Liste des actifs sur le projet (Style Texte Brut Alignement Droite)
// =========================

async function createProjectsList() {
    const projectId = getProjectId();
    if (!projectId) return;

    // Supprime l'ancienne liste si elle existe déjà
    document.getElementById("scratchping-list")?.remove();

    const container = document.createElement("div");
    container.id = "scratchping-list";

    // Style minimaliste : transparent, pas de box, aligné à droite
    container.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 25px;
        width: 250px;
        max-height: 250px;
        overflow-y: auto;
        background: transparent;
        padding: 0;
        z-index: 999998;
        font-family: Outfit, sans-serif;
        text-align: right;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
    `;

    const title = document.createElement("div");
    title.textContent = "Active Players";
    title.style.cssText = `
        font-weight: 700;
        margin-bottom: 6px;
        color: #855cd6;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    `;
    container.appendChild(title);

    // Récupération de la session et des logs cloud via le background script
    const sessionId = await sendMsg({ type: 'GET_SESSION' });
    const logs = await sendMsg({ type: 'GET_SCRATCH_LOGS', projectId, sessionId });

    const CINQ_MIN = 5 * 60 * 1000;
    const now = Date.now();
    const lastSeen = {};

    if (logs && Array.isArray(logs)) {
        logs.forEach(log => {
            const tsMs = log.timestamp < 1e10 ? log.timestamp * 1000 : log.timestamp;
            if ((now - tsMs) < CINQ_MIN) {
                if (!lastSeen[log.user] || tsMs > lastSeen[log.user]) {
                    lastSeen[log.user] = tsMs;
                }
            }
        });
    }

    const activePlayers = Object.entries(lastSeen).sort((a, b) => b[1] - a[1]);

    if (activePlayers.length === 0) {
        const empty = document.createElement("div");
        empty.textContent = "None";
        empty.style.cssText = `
            opacity: .5;
            font-size: 12px;
            font-style: italic;
            color: #575e75;
        `;
        container.appendChild(empty);
    } else {
        activePlayers.forEach(([user, ts]) => {
            const item = document.createElement("div");
            item.style.cssText = `
                padding: 3px 0;
                font-size: 13px;
                color: #575e75;
                display: block;
            `;

            const userLink = document.createElement("a");
            userLink.href = `https://scratch.mit.edu/users/${user}`;
            userLink.target = "_blank";
            userLink.textContent = user;
            userLink.style.cssText = `
                color: #855cd6;
                text-decoration: none;
                font-weight: 600;
                margin-right: 6px;
            `;

            const timeSpan = document.createElement("span");
            timeSpan.textContent = `(${tempsRelatif(ts)})`;
            timeSpan.style.cssText = `
                opacity: 0.5;
                font-size: 11px;
            `;

            item.appendChild(userLink);
            item.appendChild(timeSpan);
            container.appendChild(item);
        });
    }

    document.body.appendChild(container);
}

// =========================
// Bouton principal
// =========================

async function injectButton(projectId) {
    document.getElementById("scratchping-btn")?.remove();

    let alreadyAdded = await isAlreadyAdded(projectId);

    const btn = document.createElement("button");
    btn.id = "scratchping-btn";
    btn.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 25px;
        z-index: 999999;
        border: none;
        border-radius: 12px;
        padding: 10px 16px;
        font-size: 13px;
        font-weight: 600;
        font-family: Outfit, sans-serif;
        box-shadow: 0 4px 16px rgba(133,92,214,.35);
        cursor: pointer;
        transition: .2s;
    `;

    function updateButton() {
        if (alreadyAdded) {
            btn.innerHTML = `<img src="${chrome.runtime.getURL("icons/icon16_normal.png")}" style="width:14px;vertical-align:middle;margin-right:5px"> Already in ScratchPing`;
            btn.style.background = "#e8e0f8";
            btn.style.color = "#855cd6";
        } else {
            btn.innerHTML = `<img src="${chrome.runtime.getURL("icons/icon16_normal.png")}" style="width:14px;vertical-align:middle;margin-right:5px"> Add to ScratchPing`;
            btn.style.background = "#855cd6";
            btn.style.color = "white";
        }
    }

    updateButton();

    btn.addEventListener("click", async () => {
        if (btn.dataset.busy) return;
        btn.dataset.busy = "1";

        if (!alreadyAdded) {
            btn.innerHTML = "⏳ Adding...";
            const success = await addProject(projectId);
            if (success) {
                alreadyAdded = true;
                updateButton();
            } else {
                btn.innerHTML = "❌ Error";
            }
        } else {
            btn.innerHTML = "⏳ Removing...";
            const success = await removeProject(projectId);
            if (success) {
                alreadyAdded = false;
                updateButton();
            } else {
                btn.innerHTML = "❌ Error";
            }
        }

        delete btn.dataset.busy;
    });

    document.body.appendChild(btn);
}

// =========================
// Initialisation
// =========================

async function main() {
    const projectId = getProjectId();
    if (!projectId) return;

    await createProjectsList();
    await injectButton(projectId);
}

main();

// Actualisation automatique de la liste de joueurs toutes les 15 secondes
setInterval(() => {
    const projectId = getProjectId();
    if (projectId) createProjectsList();
}, 15000);

// =========================
// Navigation Scratch SPA
// =========================

let lastUrl = location.href;

new MutationObserver(() => {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        main();
    }
}).observe(document.body, {
    subtree: true,
    childList: true
});