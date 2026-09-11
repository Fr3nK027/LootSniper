:root { --bg: #0f172a; --panel: #1e293b; --accent: #10b981; --accent-hover: #059669; --text: #f8fafc; --success: #10b981; --warning: #f59e0b; --danger: #ef4444; }
* { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
body { background: var(--bg); color: var(--text); display: flex; height: 100vh; overflow: hidden; }

.sidebar { width: 340px; background: var(--panel); padding: 25px; display: flex; flex-direction: column; gap: 20px; border-right: 1px solid #334155; overflow-y: auto; }
.logo { font-size: 26px; font-weight: 900; color: var(--accent); display: flex; align-items: center; gap: 10px; margin-bottom: 10px;}

.btn-sync { background: #3b82f6; color: white; border: none; padding: 12px; border-radius: 8px; font-weight: bold; cursor: pointer; transition: 0.2s; }
.btn-sync:hover { background: #2563eb; }

.search-box { background: #0f172a; padding: 15px; border-radius: 8px; border: 1px solid #334155; display: flex; flex-direction: column; gap: 10px; }
.search-box label { font-size: 11px; font-weight: bold; color: #94a3b8; text-transform: uppercase; }
.search-box input, .search-box select { background: var(--panel); border: 1px solid #334155; color: white; padding: 10px; border-radius: 6px; outline: none; }
.btn-add { background: var(--accent); color: white; border: none; padding: 10px; border-radius: 6px; font-weight: bold; cursor: pointer; margin-top: 5px;}

.link-list { display: flex; flex-direction: column; gap: 8px; }
.link-item { background: #0f172a; padding: 10px; border-radius: 6px; border: 1px solid #334155; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
.link-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
.del-btn { color: var(--danger); cursor: pointer; background: none; border: none; font-weight: bold; }

.main { flex: 1; padding: 30px; overflow-y: auto; }
.header { margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; }
.sort-select { background: var(--panel); color: white; border: 1px solid #334155; padding: 10px 15px; border-radius: 8px; font-weight: bold; outline: none; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; }
.card { background: var(--panel); border-radius: 12px; overflow: hidden; border: 1px solid #334155; display: flex; flex-direction: column; transition: 0.2s;}
.card:hover { border-color: var(--accent); transform: translateY(-3px);}
.card-header { padding: 15px; border-bottom: 1px solid #334155; }
.card-title { font-size: 14px; font-weight: bold; color: #e2e8f0; margin-top: 5px; }
.platform-badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; text-transform: uppercase; }
.vinted { background: #007782; } .ebay { background: #e53238; } .subito { background: #ff4a3d; }

.card-body { padding: 15px; flex: 1; }
.prices { display: flex; justify-content: space-between; align-items: center; background: #0f172a; padding: 15px; border-radius: 8px; border-left: 4px solid var(--accent); margin-bottom: 10px; }
.req-price { font-size: 22px; font-weight: 900; color: var(--success); }
.est-price { text-align: right; }
.est-price strong { font-size: 16px; color: var(--warning); text-decoration: line-through; }
.card-footer { padding: 15px; display: flex; gap: 10px; background: #0f172a; }
.btn-link { flex: 1; text-align: center; background: #334155; color: white; text-decoration: none; padding: 10px; border-radius: 6px; font-size: 13px; font-weight: bold; }

@media (max-width: 768px) {
    body { flex-direction: column; }
    .sidebar { width: 100%; border-right: none; border-bottom: 1px solid #334155; max-height: 40vh; }
    .main { max-height: 60vh; }
}