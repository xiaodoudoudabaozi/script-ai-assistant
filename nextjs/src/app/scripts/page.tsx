"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface Script {
  id: string;
  name: string;
  author?: string;
  genre?: string;
  player_count?: string;
  act_count?: number;
  difficulty?: string;
  duration?: string;
  is_sensitive?: boolean;
  sensitivity_note?: string;
  created_at: string;
}

interface ScriptFile {
  id: string;
  file_name: string;
  file_type: string;
  character_name: string | null;
  file_size: number;
  cached_at: string;
}

interface FileEntry {
  id: string;
  file: File;
  relativePath: string;  // 文件夹内相对路径
  fileType: string;
  characterName: string;
  status: "pending" | "parsing" | "done" | "error" | "deduped";
  error: string;
}

const GENRES = ["情感", "推理", "恐怖", "机制", "欢乐", "阵营", "其他"];
const DIFFICULTIES = ["简单", "中等", "困难"];
const FILE_TYPES = [
  { value: "dm_manual", label: "DM手册" },
  { value: "main_script", label: "主剧本" },
  { value: "character_script", label: "角色剧本" },
  { value: "clue_card", label: "线索卡" },
  { value: "image_clue", label: "图片线索" },
  { value: "ending", label: "结局/返场" },
  { value: "other", label: "其他" },
];
const MAX_SIZE = 500 * 1024 * 1024;
const ALLOWED_EXTS = new Set(["docx", "doc", "pdf", "png", "jpg", "jpeg"]);

export default function ScriptsPage() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingScript, setEditingScript] = useState<Script | null>(null);
  const [form, setForm] = useState({
    name: "", author: "", genre: "", player_count: "", act_count: 0,
    difficulty: "", duration: "", is_sensitive: false, sensitivity_note: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [isAdmin, setIsAdmin] = useState(false);
  const [parseStatuses, setParseStatuses] = useState<Record<string, { total: number; parsed: number; pending: number }>>({});
  const router = useRouter();

  // 批量上传
  const [fileEntries, setFileEntries] = useState<FileEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [existingFiles, setExistingFiles] = useState<ScriptFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // 进度
  const totalFiles = fileEntries.length;
  const doneFiles = fileEntries.filter(e => e.status === "done" || e.status === "deduped").length;
  const errorFiles = fileEntries.filter(e => e.status === "error").length;

  useEffect(() => {
    const userData = localStorage.getItem("user");
    if (!userData) { router.push("/"); return; }
    let u; try { u = JSON.parse(userData); } catch { router.push("/"); return; }
    setIsAdmin(u.role === "admin");
    fetchScripts();
  }, []);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") fetchScripts(keyword); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [keyword]);

  // 轮询解析进度
  useEffect(() => {
    if (scripts.length === 0) return;
    let active = true;
    const poll = () => {
      if (!active) return;
      Promise.all(
        scripts.map(s =>
          fetch(`/api/scripts/parse-status?scriptId=${s.id}`)
            .then(r => r.json())
            .then(d => ({ id: s.id, ...d }))
            .catch(() => null)
        )
      ).then(results => {
        if (!active) return;
        const map: Record<string, any> = {};
        for (const r of results) {
          if (r) map[r.id] = { total: r.total, parsed: r.parsed, pending: r.pending };
        }
        setParseStatuses(map);
        // 有未完成的继续轮询
        const hasPending = results.some(r => r && r.pending > 0);
        if (hasPending) setTimeout(poll, 5000);
      });
    };
    poll();
    return () => { active = false; };
  }, [scripts]);

  async function fetchScripts(kw?: string) {
    try {
      const resp = await fetch("/api/scripts/list");
      const data = await resp.json();
      if (resp.ok) {
        const filtered = kw ? (data.scripts || []).filter((s: Script) => s.name.includes(kw)) : (data.scripts || []);
        setScripts(filtered);
      } else setError(data.error || "加载失败");
    } catch { setError("加载剧本列表失败"); }
    finally { setLoading(false); }
  }

  function handleSearch() { fetchScripts(keyword); }

  // ─── 文件处理 ───

  function addFiles(files: FileList | File[], relativePath?: string) {
    const newEntries: FileEntry[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f || f.size === 0) continue;
      let err = "";
      if (f.size > MAX_SIZE) err = "超过500MB";
      else {
        const ext = f.name.split(".").pop()?.toLowerCase() || "";
        if (!ALLOWED_EXTS.has(ext)) err = "格式不支持";
      }
      const path = relativePath || (f as any).webkitRelativePath || f.name;
      newEntries.push({
        id: crypto.randomUUID(),
        file: f,
        relativePath: path,
        fileType: "dm_manual",
        characterName: "",
        status: err ? "error" : "pending",
        error: err,
      });
    }
    setFileEntries(prev => [...prev, ...newEntries]);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  }

  function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const items = e.dataTransfer.items;
    if (!items) { addFiles(e.dataTransfer.files); return; }

    // 递归遍历文件夹
    const allFiles: File[] = [];
    let pending = items.length;
    for (let i = 0; i < items.length; i++) {
      traverseEntry(items[i].webkitGetAsEntry(), allFiles, () => {
        pending--;
        if (pending === 0 && allFiles.length > 0) addFiles(allFiles);
      });
    }
  }

  function traverseEntry(entry: FileSystemEntry | null, files: File[], done: () => void) {
    if (!entry) { done(); return; }
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file(f => { files.push(f); done(); }, () => done());
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      reader.readEntries(entries => {
        if (entries.length === 0) { done(); return; }
        let remaining = entries.length;
        for (const e of entries) {
          traverseEntry(e, files, () => { remaining--; if (remaining === 0) done(); });
        }
      }, () => done());
    } else { done(); }
  }

  function updateEntry(id: string, patch: Partial<FileEntry>) {
    setFileEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  }

  function removeEntry(id: string) {
    setFileEntries(prev => prev.filter(e => e.id !== id));
  }

  function clearEntries() {
    setFileEntries([]);
    setExistingFiles([]);
  }

  // ─── 提交 ───

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const pendingFiles = fileEntries.filter(e => e.status === "pending");
    if (!form.name) { setError("请填写剧本名称"); return; }
    if (!editingScript && pendingFiles.length === 0 && existingFiles.length === 0) {
      setError("请至少添加一个文件");
      return;
    }

    if (pendingFiles.length === 0) {
      // 仅元数据保存
      setBusy(true);
      const url = editingScript ? `/api/scripts/meta/${editingScript.id}` : "/api/scripts/meta";
      const method = editingScript ? "PUT" : "POST";
      try {
        const resp = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
        if (resp.ok) { setShowModal(false); clearEntries(); resetForm(); fetchScripts(keyword); }
        else { const data = await resp.json(); setError(data.error || "操作失败"); }
      } catch { setError("网络错误"); }
      finally { setBusy(false); }
      return;
    }

    // 标记所有 pending 为 parsing
    for (const e of pendingFiles) updateEntry(e.id, { status: "parsing" });
    setBusy(true);

    try {
      const fd = new FormData();
      fd.append("scriptName", form.name);
      if (editingScript) fd.append("scriptId", editingScript.id);
      if (form.author) fd.append("author", form.author);
      if (form.genre) fd.append("genre", form.genre);
      if (form.player_count) fd.append("player_count", form.player_count);
      if (form.act_count) fd.append("act_count", String(form.act_count));
      if (form.difficulty) fd.append("difficulty", form.difficulty);
      if (form.duration) fd.append("duration", form.duration);
      if (form.is_sensitive) fd.append("is_sensitive", "true");
      if (form.sensitivity_note) fd.append("sensitivity_note", form.sensitivity_note);

      for (const entry of pendingFiles) {
        fd.append("files", entry.file);
        fd.append("fileType", entry.fileType);
        fd.append("characterName", entry.characterName);
      }

      const resp = await fetch("/api/scripts/upload", { method: "POST", body: fd });
      const data = await resp.json();

      if (resp.ok && data.files) {
        // 更新状态：parsing=后台解析中, deduped=已去重
        for (let i = 0; i < pendingFiles.length; i++) {
          const entry = pendingFiles[i];
          const result = data.files[i];
          if (result) {
            if (result.status === "parsing") {
              updateEntry(entry.id, { status: "done" });
            } else if (result.status === "deduped") {
              updateEntry(entry.id, { status: "deduped" });
            } else {
              updateEntry(entry.id, { status: "error", error: "上传失败" });
            }
          }
        }
        // 全部已接收 → 关闭弹窗
        const allDone = data.files.every((r: any) => r.status === "parsing" || r.status === "deduped");
        if (allDone) {
          setError("");
          setTimeout(() => { setShowModal(false); clearEntries(); resetForm(); fetchScripts(keyword); }, 800);
        }
      } else {
        for (const e of pendingFiles) updateEntry(e.id, { status: "error", error: data.error || "上传失败" });
        setError(data.error || "上传失败");
      }
    } catch { setError("网络错误"); }
    finally { setBusy(false); }
  }

  // ─── 删除 ───

  async function handleDelete(id: string) {
    if (!confirm("确定删除该剧本？")) return;
    setDeleting(prev => new Set(prev).add(id));
    try {
      const resp = await fetch(`/api/scripts/meta/${id}`, { method: "DELETE" });
      if (resp.ok) { fetchScripts(keyword); }
      else { const data = await resp.json(); setError(data.error || "删除失败"); }
    } catch { setError("删除失败"); }
    finally { setDeleting(prev => { const next = new Set(prev); next.delete(id); return next; }); }
  }

  async function handleDeleteFile(fileId: string) {
    if (!confirm("确定删除该文件？")) return;
    try {
      const resp = await fetch(`/api/scripts/files/${fileId}`, { method: "DELETE" });
      if (resp.ok) setExistingFiles(prev => prev.filter(f => f.id !== fileId));
      else { const data = await resp.json(); setError(data.error || "删除失败"); }
    } catch { setError("网络错误"); }
  }

  async function handleAutoClassify() {
    const pending = fileEntries.filter(e => e.status === "pending" && !e.error);
    if (pending.length === 0) { setError("没有待分类的文件"); return; }
    setError("");
    setBusy(true);

    try {
      // 读取每个文件的前 2000 字符
      const files = await Promise.all(
        pending.map(async (entry) => {
          const text = await readFilePreview(entry.file, 2000);
          return { fileName: entry.file.name, preview: text };
        })
      );

      const resp = await fetch("/api/scripts/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      const data = await resp.json();

      if (resp.ok && data.classifications) {
        for (let i = 0; i < pending.length; i++) {
          const cls = data.classifications[i];
          if (cls) {
            updateEntry(pending[i].id, { fileType: cls.fileType, characterName: cls.characterName || "" });
          }
        }
      } else {
        setError(data.error || "AI 分类失败");
      }
    } catch { setError("AI 分类请求失败"); }
    finally { setBusy(false); }
  }

  function readFilePreview(file: File, maxChars: number): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        resolve(text.slice(0, maxChars));
      };
      reader.onerror = () => resolve("");
      // 只读开头
      const slice = file.slice(0, Math.min(file.size, 8192));
      reader.readAsText(slice);
    });
  }

  function resetForm() {
    setForm({ name: "", author: "", genre: "", player_count: "", act_count: 0, difficulty: "", duration: "", is_sensitive: false, sensitivity_note: "" });
    setEditingScript(null);
  }

  async function openEdit(s: Script) {
    setEditingScript(s);
    setForm({
      name: s.name, author: s.author || "", genre: s.genre || "",
      player_count: s.player_count || "", act_count: s.act_count || 0,
      difficulty: s.difficulty || "", duration: s.duration || "",
      is_sensitive: s.is_sensitive || false, sensitivity_note: s.sensitivity_note || "",
    });
    clearEntries();
    setError("");
    try {
      const resp = await fetch(`/api/scripts/files?scriptId=${s.id}`);
      if (resp.ok) { const data = await resp.json(); setExistingFiles(data.files || []); }
    } catch { /* ignore */ }
    setShowModal(true);
  }

  function openCreate() {
    resetForm();
    clearEntries();
    setShowModal(true);
  }

  // ─── 渲染辅助 ───

  const statusIcon: Record<string, string> = {
    pending: "○",
    parsing: "⟳",
    done: "✓",
    deduped: "≣",
    error: "✗",
  };
  const statusColor: Record<string, string> = {
    pending: "text-gray-400",
    parsing: "text-blue-500 animate-spin inline-block",
    done: "text-green-500",
    deduped: "text-blue-500",
    error: "text-red-500",
  };
  const statusBg: Record<string, string> = {
    pending: "bg-white",
    parsing: "bg-blue-50",
    done: "bg-green-50",
    deduped: "bg-blue-50",
    error: "bg-red-50",
  };

  if (loading) return <div className="p-4">加载中...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-5xl mx-auto">
        <a href="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600 mb-3">← 返回大厅</a>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">剧本管理</h1>
          {isAdmin && (
            <button onClick={openCreate} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              + 添加剧本
            </button>
          )}
        </div>

        <div className="flex gap-2 mb-4">
          <input type="text" value={keyword} onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="搜索剧本名/作者" className="flex-1 px-3 py-2 border rounded-lg" />
          <button onClick={handleSearch} className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200">搜索</button>
        </div>

        <div className="grid gap-3">
          {scripts.map(s => (
            <div key={s.id} className="bg-white p-4 rounded-lg shadow flex items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg">{s.name}</span>
                  {parseStatuses[s.id] && parseStatuses[s.id].pending > 0 && (
                    <span className="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-700 rounded font-medium animate-pulse">
                      {parseStatuses[s.id].parsed}/{parseStatuses[s.id].total} 已解析
                    </span>
                  )}
                  {parseStatuses[s.id] && parseStatuses[s.id].pending === 0 && parseStatuses[s.id].total > 0 && (
                    <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded font-medium">✓ 全部就绪</span>
                  )}
                  {s.is_sensitive && <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded">敏感本</span>}
                </div>
                <div className="flex flex-wrap gap-2 mt-2 text-sm text-gray-500">
                  {s.author && <span>作者: {s.author}</span>}
                  {s.genre && <span>类型: {s.genre}</span>}
                  {s.player_count && <span>{s.player_count}人</span>}
                  {s.difficulty && <span>难度: {s.difficulty}</span>}
                  {s.duration && <span>时长: {s.duration}</span>}
                  {s.act_count ? <span>{s.act_count}幕</span> : null}
                </div>
                {s.is_sensitive && s.sensitivity_note && (
                  <div className="mt-1 text-xs text-red-500">敏感说明: {s.sensitivity_note}</div>
                )}
              </div>
              {isAdmin && (
                <div className="flex gap-2">
                  <button onClick={() => openEdit(s)} disabled={deleting.has(s.id)} className="text-sm text-blue-600 hover:underline disabled:opacity-50">编辑</button>
                  <button onClick={() => handleDelete(s.id)} disabled={deleting.has(s.id)} className="text-sm text-red-600 hover:underline disabled:opacity-50">{deleting.has(s.id) ? "删除中..." : "删除"}</button>
                </div>
              )}
            </div>
          ))}
          {scripts.length === 0 && (
            <div className="text-center text-gray-400 py-12">暂无剧本，点击"+ 添加剧本"开始录入</div>
          )}
        </div>
      </div>

      {/* 上传弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold mb-4">{editingScript ? "编辑剧本" : "添加剧本"}</h2>
            {error && <div className="mb-3 p-2 bg-red-50 text-red-600 text-sm rounded">{error}</div>}
            <form onSubmit={handleSubmit} className="space-y-3">
              {/* 元数据 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">剧本名 *</label>
                <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" required disabled={busy} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">作者</label>
                  <input type="text" value={form.author} onChange={e => setForm({...form, author: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" disabled={busy} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
                  <select value={form.genre} onChange={e => setForm({...form, genre: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" disabled={busy}>
                    <option value="">选择</option>
                    {GENRES.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">人数</label>
                  <input type="text" value={form.player_count} onChange={e => setForm({...form, player_count: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" placeholder="如: 6-8" disabled={busy} /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">幕数</label>
                  <input type="number" value={form.act_count} onChange={e => setForm({...form, act_count: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" disabled={busy} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">难度</label>
                  <select value={form.difficulty} onChange={e => setForm({...form, difficulty: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" disabled={busy}>
                    <option value="">选择</option>
                    {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">时长</label>
                  <input type="text" value={form.duration} onChange={e => setForm({...form, duration: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" placeholder="如: 4-5小时" disabled={busy} /></div>
              </div>

              {/* 已有文件 */}
              {editingScript && existingFiles.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">已有文件 ({existingFiles.length})</label>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {existingFiles.map(f => (
                      <div key={f.id} className="flex items-center gap-2 text-sm bg-gray-50 px-3 py-2 rounded">
                        <span className="flex-1 truncate">{f.file_name}</span>
                        <span className="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">{FILE_TYPES.find(t => t.value === f.file_type)?.label || f.file_type}</span>
                        {f.character_name && <span className="text-xs text-gray-500">{f.character_name}</span>}
                        <button type="button" onClick={() => handleDeleteFile(f.id)} disabled={busy} className="text-red-400 hover:text-red-600 disabled:opacity-30 shrink-0">×</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 批量上传区 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">
                    上传文件 {!editingScript && "*"} ({totalFiles > 0 ? `${doneFiles}/${totalFiles} 完成` : "拖入文件夹或文件"})
                  </label>
                  {fileEntries.some(e => e.status === "pending") && (
                    <button type="button" onClick={handleAutoClassify} disabled={busy}
                      className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50">
                      🤖 AI 自动分类
                    </button>
                  )}
                </div>

                {/* 进度条 */}
                {totalFiles > 0 && busy && (
                  <div className="w-full h-1.5 bg-gray-200 rounded-full mb-2 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${totalFiles > 0 ? Math.round((doneFiles + errorFiles) / totalFiles * 100) : 0}%` }} />
                  </div>
                )}

                {/* 拖拽区 */}
                <div
                  className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
                    dragOver ? "border-blue-400 bg-blue-50" : "border-gray-300 hover:border-gray-400"
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <div className="text-sm text-gray-400">
                    <p>拖拽文件或文件夹到此处</p>
                    <p className="text-xs mt-1">支持 DOCX / DOC / PDF / PNG / JPG，单文件最大 500MB | 支持文件夹批量导入</p>
                  </div>
                  <div className="flex gap-2 justify-center mt-2">
                    <button type="button" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                      className="px-3 py-1 text-xs bg-white border rounded hover:bg-gray-50 disabled:opacity-50" disabled={busy}>选择文件</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click(); }}
                      className="px-3 py-1 text-xs bg-white border rounded hover:bg-gray-50 disabled:opacity-50" disabled={busy}>选择文件夹</button>
                  </div>
                </div>

                <input ref={fileInputRef} type="file" accept=".docx,.doc,.pdf,.png,.jpg,.jpeg" multiple onChange={handleFileSelect} className="hidden" />
                <input ref={folderInputRef} type="file" {...({ webkitdirectory: "" } as any)} multiple onChange={handleFolderSelect} className="hidden" />

                {/* 文件列表 */}
                {fileEntries.length > 0 && (
                  <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                    {fileEntries.map(entry => (
                      <div key={entry.id} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded ${statusBg[entry.status]}`}>
                        <span className={`text-xs font-mono shrink-0 ${statusColor[entry.status]}`}>{statusIcon[entry.status]}</span>
                        <span className="flex-1 truncate text-xs" title={entry.relativePath}>{entry.relativePath.split("/").pop() || entry.file.name}</span>
                        <span className="text-xs text-gray-400 shrink-0">{(entry.file.size / 1024 / 1024).toFixed(1)}MB</span>

                        {entry.status === "pending" && (
                          <>
                            <select value={entry.fileType} onChange={e => updateEntry(entry.id, { fileType: e.target.value })}
                              disabled={busy} className="px-1.5 py-0.5 text-xs border rounded bg-white">
                              {FILE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                            {entry.fileType === "character_script" && (
                              <input type="text" value={entry.characterName} onChange={e => updateEntry(entry.id, { characterName: e.target.value })}
                                placeholder="角色名" disabled={busy} className="w-16 px-1 py-0.5 text-xs border rounded" />
                            )}
                          </>
                        )}

                        {entry.status === "deduped" && <span className="text-xs text-blue-500 shrink-0">内容重复已合并</span>}
                        {entry.status === "error" && <span className="text-xs text-red-500 shrink-0" title={entry.error}>{entry.error}</span>}

                        {(entry.status === "pending" || entry.status === "error") && (
                          <button type="button" onClick={() => removeEntry(entry.id)} disabled={busy}
                            className="text-red-400 hover:text-red-600 shrink-0">×</button>
                        )}
                      </div>
                    ))}
                    {fileEntries.length > 0 && fileEntries.every(e => e.status !== "pending" && e.status !== "parsing") && (
                      <div className={`text-xs text-center py-1 rounded ${errorFiles > 0 ? "text-red-500 bg-red-50 px-2" : "text-gray-400"}`}>
                        {errorFiles > 0
                          ? `${errorFiles} 个文件失败，可移除后重新添加，或直接保存已有文件`
                          : "全部就绪，请点击保存"}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input type="checkbox" checked={form.is_sensitive} onChange={e => setForm({...form, is_sensitive: e.target.checked})} id="sensitive" disabled={busy} />
                <label htmlFor="sensitive" className="text-sm text-gray-700">标记为敏感本</label>
              </div>
              {form.is_sensitive && (
                <div><label className="block text-sm font-medium text-gray-700 mb-1">敏感说明</label>
                  <input type="text" value={form.sensitivity_note} onChange={e => setForm({...form, sensitivity_note: e.target.value})}
                    className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" placeholder="如：含恐怖、血腥内容" disabled={busy} /></div>
              )}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setShowModal(false); clearEntries(); resetForm(); }} disabled={busy}
                  className="flex-1 px-4 py-2 bg-gray-100 rounded-lg disabled:opacity-50">取消</button>
                <button type="submit" disabled={busy || fileEntries.some(e => e.status === "parsing")}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg disabled:bg-gray-400">
                  {busy ? (doneFiles > 0 ? `处理中 (${doneFiles}/${totalFiles})` : "处理中...") : "保存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
