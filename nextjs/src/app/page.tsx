"use client";

import { useState, useEffect, useRef } from "react";

interface ScriptInfo { id: string; name?: string; genre?: string; player_count?: string; difficulty?: string; is_sensitive?: boolean; }
interface ChatMessage { role: "user" | "assistant"; content: string; }

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [scripts, setScripts] = useState<ScriptInfo[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(true);
  const [selectedScript, setSelectedScript] = useState<ScriptInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [showScriptPicker, setShowScriptPicker] = useState(false);
  const [scriptSearch, setScriptSearch] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [characterName, setCharacterName] = useState("");  // 角色过滤
  const [characterList, setCharacterList] = useState<string[]>([]);

  const msgEnd = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // 登录检查
  useEffect(() => {
    const u = localStorage.getItem("user");
    if (u) try { setUser(JSON.parse(u)); } catch {}
  }, []);

  // 加载剧本
  useEffect(() => { fetch("/api/scripts/list").then(r => r.json()).then(d => setScripts(d.scripts || [])).catch(() => setError("加载剧本列表失败")).finally(() => setScriptsLoading(false)); }, []);

  // 自动滚动
  useEffect(() => { msgEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // 点击外部关闭剧本选择器
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowScriptPicker(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 页面可见时刷新剧本列表
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") { fetch("/api/scripts/list").then(r => r.json()).then(d => setScripts(d.scripts || [])).catch(() => {}); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // 选剧本 → 先加载已有对话+历史，没有才创建新对话
  const selectScript = async (s: ScriptInfo) => {
    setSelectedScript(s);
    setShowScriptPicker(false);
    setScriptSearch("");
    setMessages([]);
    setError("");
    setCharacterName("");
    setCharacterList([]);
    setHistoryLoading(true);
    try {
      // 1. 先查已有对话
      const listR = await fetch(`/api/conversations?scriptId=${s.id}`);
      if (!listR.ok) { setError("加载对话列表失败"); setHistoryLoading(false); return; }
      const listD = await listR.json();
      if (listD.conversations?.length > 0) {
        // 有已有对话 → 选最新的 + 加载历史
        const conv = listD.conversations[0];
        setConversationId(conv.id);
        const histR = await fetch(`/api/chat/history?conversationId=${conv.id}`);
        if (!histR.ok) {
          setError("加载对话历史失败，请重试");
          setHistoryLoading(false);
          return;
        }
        const histD = await histR.json();
        setMessages(histD.messages || []);
        setHistoryLoading(false);
        return;
      }
      // 2. 无对话 → 创建新对话
      const r = await fetch("/api/conversations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId: s.id }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({ error: "创建对话失败" }));
        setError(d.error || "创建对话失败");
        setHistoryLoading(false);
        return;
      }
      setConversationId((await r.json()).conversation.id);
    } catch (e: any) { setError("创建对话失败: " + (e.message || "")); }
    setHistoryLoading(false);

    // 异步加载角色列表
    fetch(`/api/scripts/files?scriptId=${s.id}`).then(r => r.json()).then(d => {
      const seen = new Set<string>();
      const chars: string[] = [];
      for (const f of (d.files || [])) {
        if (f.character_name && !seen.has(f.character_name)) {
          seen.add(f.character_name);
          chars.push(f.character_name);
        }
      }
      setCharacterList(chars);
    }).catch(() => {});
  };

  // 新建对话
  const newConversation = async () => {
    if (!selectedScript) return;
    setMessages([]); setError(""); setCharacterName("");
    try {
      const r = await fetch("/api/conversations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId: selectedScript.id }),
      });
      if (r.ok) setConversationId((await r.json()).conversation.id);
    } catch (e: any) { setError("创建新对话失败"); }
  };

  // 发送消息
  const send = async () => {
    const msg = input.trim();
    if (!msg || isLoading || !selectedScript || !conversationId) {
      if (!selectedScript) setError("请先选择剧本");
      else if (!conversationId) setError("对话未就绪，请重新选择剧本");
      return;
    }
    setError(""); setInput("");
    setMessages(p => [...p, { role: "user", content: msg }, { role: "assistant", content: "" }]);
    setIsLoading(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scriptId: selectedScript.id, conversationId, message: msg, characterName: characterName || undefined }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({ error: "请求失败" }));
        setMessages(p => { const u = [...p]; u[u.length-1] = { role: "assistant", content: `❌ ${d.error}` }; return u; });
        setIsLoading(false); return;
      }
      const reader = r.body?.getReader();
      if (!reader) { setIsLoading(false); return; }
      const dec = new TextDecoder(); let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
          const t = line.trim(); if (!t.startsWith("data: ")) continue;
          const d2 = t.slice(6);
          if (d2 === "[DONE]") { setIsLoading(false); continue; }
          try {
            const p = JSON.parse(d2);
            if (p.error) { setMessages(prev => { const u = [...prev]; u[u.length-1] = { ...u[u.length-1], content: (u[u.length-1].content||"") + `\n❌ ${p.error}` }; return u; }); setIsLoading(false); }
            if (p.content) { setMessages(prev => { const u = [...prev]; u[u.length-1] = { ...u[u.length-1], content: u[u.length-1].content + p.content }; return u; }); }
          } catch {}
        }
      }
      setIsLoading(false);
    } catch (e: any) {
      setMessages(p => { const u = [...p]; u[u.length-1] = { ...u[u.length-1], content: `❌ 发送失败: ${e.message||"网络错误"}` }; return u; });
      setIsLoading(false);
    }
  };

  const filteredScripts = scriptSearch ? scripts.filter(s => (s.name||"").toLowerCase().includes(scriptSearch.toLowerCase())) : scripts;
  const genres = [...new Set(scripts.map((s: any) => s.genre).filter(Boolean))];

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* 顶部栏：选择剧本 | 搜索 | 新对话 */}
      <header className="flex items-center gap-2 px-3 py-2 bg-white border-b shadow-sm z-30">
        <h1 className="text-base font-bold whitespace-nowrap hidden sm:block">AI助手</h1>

        {user ? (
          <div className="flex items-center gap-2 flex-1">
            {/* 选择剧本按钮 */}
            <div className="relative" ref={pickerRef}>
              <button
                onClick={() => setShowScriptPicker(!showScriptPicker)}
                className={`px-3 py-2 text-sm rounded-lg border whitespace-nowrap transition-colors ${
                  selectedScript ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                }`}
              >
                {selectedScript ? selectedScript.name : "+ 选择剧本"}
              </button>
              {/* 剧本选择弹窗 */}
              {showScriptPicker && (
                <div className="absolute top-full left-0 mt-1 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-80 overflow-hidden flex flex-col">
                  <div className="p-2 border-b">
                    <input type="text" value={scriptSearch} onChange={e => setScriptSearch(e.target.value)}
                      placeholder="搜索剧本..." autoFocus
                      className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                  {genres.length > 0 && (
                    <div className="px-2 py-1 border-b flex flex-wrap gap-1">
                      {genres.slice(0,8).map((g: any) => (
                        <button key={g} onClick={() => setScriptSearch(g)} className="px-2 py-0.5 text-xs bg-gray-100 rounded-full hover:bg-gray-200">{g}</button>
                      ))}
                    </div>
                  )}
                  <div className="overflow-y-auto flex-1">
                    {scriptsLoading ? (
                      <div className="p-4 text-sm text-gray-400 text-center">加载中...</div>
                    ) : (
                      <>
                        {filteredScripts.map(s => (
                          <button key={s.id} onClick={() => selectScript(s)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 border-b border-gray-50">
                            <span className="flex-1">{s.name}</span>
                            {(s as any).genre && <span className="text-xs text-gray-400">{(s as any).genre}</span>}
                            {(s as any).player_count && <span className="text-xs text-gray-400">{(s as any).player_count}人</span>}
                          </button>
                        ))}
                        {filteredScripts.length === 0 && <div className="p-4 text-sm text-gray-400 text-center">{scripts.length === 0 ? "暂无可选剧本" : "无匹配剧本"}</div>}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 搜索框 */}
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索对话历史..."
              className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400" />

            {/* 新对话按钮 */}
            <button onClick={newConversation} disabled={!selectedScript}
              title="创建新的对话线程"
              className="px-3 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed whitespace-nowrap transition-colors">
              + 新对话
            </button>

            {/* PC导航 */}
            <div className="hidden md:flex items-center gap-1 ml-1">
              {user.role==="admin" && <a href="/employees" className="text-xs text-blue-600 hover:underline px-1">员工</a>}
              <a href="/schedules" className="text-xs text-blue-600 hover:underline px-1">排班</a>
              <a href="/scripts" className="text-xs text-blue-600 hover:underline px-1">剧本</a>
              {user.role==="admin" && <a href="/adapt" className="text-xs text-purple-600 hover:underline px-1">改编</a>}
              <a href="/me" className="text-xs text-blue-600 hover:underline px-1">我的</a>
              <span className="text-xs text-gray-500 ml-1">{user.name}</span>
              <button onClick={() => { localStorage.clear(); setUser(null); }} className="text-xs text-gray-400 hover:text-gray-600 ml-1">退出</button>
            </div>
          </div>
        ) : (
          <div className="ml-auto"><span className="text-sm text-gray-500">请先登录</span></div>
        )}
      </header>

      {/* 对话区 */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {!user && <div className="max-w-md mx-auto mt-20 bg-white rounded-xl shadow p-6"><h2 className="text-xl font-bold text-center mb-6">登录</h2><LoginForm onLogin={(u: any) => { setUser(u); localStorage.setItem("user", JSON.stringify(u)); }} /></div>}

        {/* 当前剧本标签 */}
        {user && selectedScript && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-lg text-sm">
            <span className="font-medium text-blue-800">{selectedScript.name}</span>
            {(selectedScript as any).genre && <span className="bg-white px-2 py-0.5 rounded text-xs text-gray-600">{(selectedScript as any).genre}</span>}
            {(selectedScript as any).player_count && <span className="bg-white px-2 py-0.5 rounded text-xs text-gray-600">{(selectedScript as any).player_count}人</span>}
            {(selectedScript as any).difficulty && <span className="bg-white px-2 py-0.5 rounded text-xs text-gray-600">难度:{(selectedScript as any).difficulty}</span>}
            {(selectedScript as any).is_sensitive && <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded text-xs">敏感本</span>}
            {characterList.length > 0 && (
              <select
                value={characterName}
                onChange={e => setCharacterName(e.target.value)}
                className="ml-2 px-2 py-0.5 text-xs border rounded bg-white"
                title="按角色过滤上下文"
              >
                <option value="">全部角色</option>
                {characterList.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {characterName && (
              <span className="text-xs text-purple-600">仅看{characterName}视角</span>
            )}
          </div>
        )}

        {error && <div className="text-center text-sm text-red-500 bg-red-50 rounded-lg py-2 px-4">{error}</div>}

        {user && messages.map((m, i) => (
          <div key={i} className={`flex ${m.role==="user"?"justify-end":"justify-start"}`}>
            <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${m.role==="user"?"bg-blue-600 text-white":"bg-white border shadow-sm"}`}>
              {m.content || <span className="inline-flex gap-1"><span className="animate-bounce">●</span><span className="animate-bounce" style={{animationDelay:"0.1s"}}>●</span><span className="animate-bounce" style={{animationDelay:"0.2s"}}>●</span></span>}
            </div>
          </div>
        ))}

        {user && messages.length===0 && !error && !historyLoading && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
            <p className="text-sm">{!selectedScript ? "点击「+ 选择剧本」开始" : "输入问题开始对话"}</p>
          </div>
        )}
        {historyLoading && (
          <div className="flex items-center justify-center py-12 text-gray-400 text-sm">加载对话历史...</div>
        )}
        <div ref={msgEnd} />
      </main>

      {/* 输入区 */}
      {user && (
        <footer className="pb-20 md:pb-3 px-4 py-3 bg-white border-t">
          <div className="flex gap-2 max-w-3xl mx-auto">
            <textarea value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={selectedScript ? "输入问题..." : "请先选择剧本"}
              disabled={isLoading} rows={1}
              className="flex-1 resize-none px-4 py-2.5 text-sm border rounded-xl disabled:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
              style={{maxHeight:"120px"}} />
            <button onClick={send} disabled={isLoading || !input.trim() || !selectedScript || !conversationId}
              className="px-5 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed whitespace-nowrap transition-colors">
              {isLoading ? "回答中..." : "发送"}
            </button>
          </div>
        </footer>
      )}

      {/* 手机底部导航 */}
      {user && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around py-2 z-40">
          <a href="/" className="flex flex-col items-center text-xs text-blue-600"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>问答</a>
          <a href="/schedules" className="flex flex-col items-center text-xs text-gray-500"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>排班</a>
          <a href="/me" className="flex flex-col items-center text-xs text-gray-500"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>我的</a>
        </nav>
      )}
    </div>
  );
}

function LoginForm({ onLogin }: { onLogin: (u: any) => void }) {
  const [id, setId] = useState(""); const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false); const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setErr("");
    try {
      const r = await fetch("/api/auth/login", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({employeeId:id,password:pw}) });
      const d = await r.json();
      if (r.ok) { localStorage.setItem("token", d.token); onLogin(d.user); }
      else setErr(d.error||"登录失败");
    } catch { setErr("网络错误"); }
    finally { setLoading(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <input type="text" value={id} onChange={e=>setId(e.target.value)} placeholder="工号或手机号" className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" required disabled={loading} />
      <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="密码" className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" required disabled={loading} />
      {err && <div className="text-sm text-red-500">{err}</div>}
      <button type="submit" disabled={loading} className="w-full py-2 text-white bg-blue-600 rounded-lg disabled:bg-gray-300">{loading?"登录中...":"登录"}</button>
    </form>
  );
}
