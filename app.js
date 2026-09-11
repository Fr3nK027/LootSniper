console.log("🚀 Il file app.js è partito senza errori!");

// Credenziali
const SUPABASE_URL = 'https://gfzzysqyddcotclnzdzl.supabase.co';
const SUPABASE_KEY = 'sb_publishable_8hAW21CnmTN2vIlpLmBZBQ_vmS43QF5';

// FIX: Chiamiamo la variabile "db" per non entrare in conflitto con la libreria originale
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let deals = [];
let links = [];

// ==========================================
// FUNZIONI PRINCIPALI
// ==========================================

window.loadData = async function() {
    try {
        console.log("🔄 Scaricamento dati in corso...");
        
        // 1. Carica le ricerche salvate
        const resLinks = await db.from('lootsniper_links').select('*');
        if (resLinks.error) throw resLinks.error;
        links = resLinks.data || [];
        document.getElementById('links-count').innerText = links.length;
        window.renderLinks();

        // 2. Carica gli affari trovati dal server
        const resDeals = await db.from('lootsniper_deals').select('*').order('created_at', { ascending: false });
        if (resDeals.error) throw resDeals.error;
        deals = resDeals.data || [];
        document.getElementById('bombs-count').innerText = deals.length;
        window.renderDeals();
        
        console.log("✅ Dati aggiornati con successo!");
    } catch (error) {
        console.error("❌ Errore caricamento:", error);
        alert("Errore caricamento dati! Messaggio: " + error.message);
    }
};

window.addLink = async function() {
    try {
        const nome = document.getElementById('l-nome').value;
        const piattaforma = document.getElementById('l-plat').value;
        const url = document.getElementById('l-url').value;
        
        if(!nome || !url) {
            alert("❌ Devi compilare Nome e URL!");
            return;
        }

        const btn = document.querySelector('.btn-add');
        btn.innerText = "⏳ Salvataggio...";

        // Inserisce i dati su Supabase usando la nuova variabile "db"
        const { error } = await db.from('lootsniper_links').insert([{ nome, piattaforma, url }]);
        
        if (error) throw error; 

        document.getElementById('l-nome').value = ''; 
        document.getElementById('l-url').value = '';
        btn.innerText = "➕ Salva sul Server";
        
        // Non facciamo alert fastidiosi, ricarichiamo e basta
        await window.loadData();

    } catch (error) {
        console.error("❌ Errore salvataggio:", error);
        alert("❌ ERRORE DATABASE:\n" + error.message);
        document.querySelector('.btn-add').innerText = "➕ Salva sul Server";
    }
};

window.deleteLink = async function(id) {
    if(confirm("Eliminare questa ricerca? Il server smetterà di monitorarla.")) {
        await db.from('lootsniper_links').delete().eq('id', id);
        window.loadData();
    }
};

window.deleteDeal = async function(id) {
    if(confirm("Scartare questa offerta?")) {
        await db.from('lootsniper_deals').delete().eq('id', id);
        window.loadData();
    }
};

// ==========================================
// RENDER GRAFICO (DISEGNO A SCHERMO)
// ==========================================

window.renderLinks = function() {
    const container = document.getElementById('links-container');
    container.innerHTML = "";
    links.forEach(l => {
        container.insertAdjacentHTML('beforeend', `
            <div class="link-item">
                <span><b>${l.piattaforma}:</b> ${l.nome}</span>
                <button class="del-btn" onclick="deleteLink('${l.id}')">X</button>
            </div>
        `);
    });
};

window.renderDeals = function() {
    const grid = document.getElementById('results-grid');
    grid.innerHTML = ""; 
    const sortVal = document.getElementById('sort-order').value;
    let sorted = [...deals]; 
    
    if (sortVal === 'margin') sorted.sort((a, b) => b.margine - a.margine);
    else if (sortVal === 'price-asc') sorted.sort((a, b) => a.prezzo - b.prezzo);
    else if (sortVal === 'date') sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    sorted.forEach(item => {
        grid.insertAdjacentHTML('beforeend', `
            <div class="card">
                <div class="card-header">
                    <span class="platform-badge ${item.piattaforma.toLowerCase()}">${item.piattaforma}</span>
                    <div class="card-title">${item.titolo.substring(0, 50)}...</div>
                </div>
                <div class="card-body">
                    <div class="prices">
                        <div><span style="font-size: 11px;">RICHIESTA</span><br><span class="req-price">${item.prezzo}€</span></div>
                        <div class="est-price"><span>VALORE</span><strong>${item.stima}€</strong><br><span style="color:var(--success); font-weight:bold;">Risparmi ${item.margine}€</span></div>
                    </div>
                </div>
                <div class="card-footer">
                    <a href="${item.url}" target="_blank" class="btn-link">Apri Annuncio ➔</a>
                    <button class="btn-link" style="flex: 0.3; background: var(--danger);" onclick="deleteDeal('${item.id}')">🗑️</button>
                </div>
            </div>
        `);
    });
};

// ==========================================
// AVVIO ALL'APERTURA
// ==========================================
setTimeout(() => {
    if (typeof window.loadData === 'function') {
        window.loadData();
    }
}, 300);