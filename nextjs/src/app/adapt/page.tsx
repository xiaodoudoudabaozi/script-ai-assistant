"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Script {
  id: string;
  name: string;
}

interface Adaptation {
  id: string;
  script_id: string;
  script_name?: string;
  operator_name?: string;
  adaptation_type: string;
  instruction: string;
  changes_summary: string;
  created_at: string;
}

const ADAPT_TYPES = [
  { value: "element_replacement", label: "🔄 元素替换 — 改具体细节，保持结构（刀杀→毒杀、民国→现代）" },
  { value: "plot_tweak", label: "📖 剧情微调 — 改逻辑衔接，不改结构（冲突提前、线索位移）" },
  { value: "perspective_expand", label: "👁 视角扩展 — 以另一角色视角重写" },
  { value: "manual_adapt", label: "📝 手册改编 — 改DM手册措辞/格式" },
];

const ADAPT_TYPE_LABELS: Record<string, string> = {
  element_replacement: "元素替换",
  plot_tweak: "剧情微调",
  perspective_expand: "视角扩展",
  manual_adapt: "手册改编",
};

export default function AdaptationsPage() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [adaptations, setAdaptations] = useState<Adaptation[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState({
    script_id: "",
    adaptation_type: "element_replacement",
    instruction: "",
  });
  const [result, setResult] = useState<{
    content: string;
    script_name: string;
    is_truncated?: boolean;
    truncation_warning?: string | null;
    adaptation_id?: string;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [originalText, setOriginalText] = useState<string | null>(null);
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const [preview, setPreview] = useState<{
    preview: string;
    need_confirm: boolean;
    confirm_message: string;
    script_name: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [versions, setVersions] = useState<any[]>([]);
  const [versionPreview, setVersionPreview] = useState<string | null>(null);
  const [versionPreviewLabel, setVersionPreviewLabel] = useState("");
  const [restoring, setRestoring] = useState(false);
  const router = useRouter();

  // 选剧本时加载版本历史
  useEffect(() => {
    if (form.script_id) fetchVersions(form.script_id); else setVersions([]);
  }, [form.script_id]);

  useEffect(() => {
    const userData = localStorage.getItem("user");
    if (!userData) { router.push("/"); return; }
    let u; try { u = JSON.parse(userData); } catch { router.push("/"); return; }
    if (u.role !== "admin") { router.push("/"); return; }
    fetchScripts();
    fetchAdaptations();
  }, []);

  async function fetchScripts() {
    try {
      const resp = await fetch("/api/scripts/meta");
      const data = await resp.json();
      if (resp.ok) setScripts(data.scripts || []);
      else setError(data.error || "加载剧本列表失败");
    } catch { setError("加载剧本列表失败"); }
  }

  async function fetchAdaptations() {
    try {
      const resp = await fetch("/api/adaptations");
      const data = await resp.json();
      if (resp.ok) setAdaptations(data.adaptations || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  // 加载版本历史
  async function fetchVersions(scriptId: string) {
    try {
      const resp = await fetch(`/api/scripts/versions?scriptId=${scriptId}`);
      if (resp.ok) {
        const data = await resp.json();
        setVersions(data.versions || []);
      }
    } catch {}
  }

  // 预览版本
  async function previewVersion(versionId: string) {
    try {
      const resp = await fetch("/api/scripts/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setVersionPreview(data.version.content);
        setVersionPreviewLabel(data.version.label);
      }
    } catch { setError("加载版本内容失败"); }
  }

  // 恢复到指定版本
  async function restoreVersion(versionId: string) {
    if (!confirm("确定恢复到此版本？当前剧本内容将被覆盖。")) return;
    setRestoring(true);
    try {
      const resp = await fetch("/api/scripts/versions/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId, scriptId: form.script_id }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setError("");
        alert(`已恢复至 ${data.label}`);
        fetchVersions(form.script_id);
      } else {
        const d = await resp.json().catch(() => ({ error: "恢复失败" }));
        setError(d.error || "恢复失败");
      }
    } catch { setError("网络错误"); }
    finally { setRestoring(false); }
  }

  // 页面可见时刷新
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") { fetchScripts(); fetchAdaptations(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Step 1: 生成改编方案预览
  async function handlePreview(e: React.FormEvent) {
    e.preventDefault();
    if (!form.script_id || !form.instruction) {
      setError("请选择剧本并填写改编指令");
      return;
    }
    setError("");
    setGenerating(true);
    setResult(null);
    setPreview(null);

    try {
      const resp = await fetch("/api/adaptations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, step: "preview" }),
      });
      const data = await resp.json();

      if (data.need_sensitive_confirm) {
        setError("⚠️ 该剧本已标记为敏感本，改编需谨慎。请再次点击确认继续。");
        setGenerating(false);
        return;
      }

      if (data.level === "prohibited") {
        setError(`🚫 ${data.error}`);
        setGenerating(false);
        return;
      }

      if (!resp.ok) {
        setError(data.error || "预览失败");
        setGenerating(false);
        return;
      }

      setPreview({
        preview: data.preview,
        need_confirm: data.need_confirm || false,
        confirm_message: data.confirm_message || "",
        script_name: data.script_name,
      });
    } catch {
      setError("网络错误");
    } finally {
      setGenerating(false);
    }
  }

  // Step 2: 确认后生成全本
  async function handleGenerate() {
    if (!preview) return;
    setError("");
    setGenerating(true);
    setPreview(null);

    try {
      const resp = await fetch("/api/adaptations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, step: "generate" }),
      });
      const data = await resp.json();
      if (resp.ok || resp.status === 201) {
        setResult({
          content: data.content,
          script_name: data.script_name,
          is_truncated: data.is_truncated,
          truncation_warning: data.truncation_warning,
          adaptation_id: data.adaptation?.id,
        });
        fetchAdaptations();
        // 刷新版本列表
        fetchVersions(form.script_id);
      } else {
        setError(data.error || "改编失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setGenerating(false);
    }
  }

  // 并排对比
  async function toggleComparison() {
    if (showComparison) {
      setShowComparison(false);
      return;
    }
    if (!result) return;
    if (!originalText) {
      setLoadingOriginal(true);
      try {
        const resp = await fetch(`/api/scripts/meta?script_id=${form.script_id}`);
        const data = await resp.json();
        if (data.scripts?.[0]) {
          const cacheResp = await fetch(`/api/scripts/cache?id=${form.script_id}`);
          if (cacheResp.ok) {
            const cacheData = await cacheResp.json();
            setOriginalText(cacheData.text || "（原始剧本文本不可用）");
          } else {
            setOriginalText("（无法加载原始文本）");
          }
        } else {
          setOriginalText("（剧本不存在）");
        }
      } catch {
        setOriginalText("（加载原始文本失败）");
      } finally {
        setLoadingOriginal(false);
      }
    }
    setShowComparison(true);
  }

  // 导出 DOCX
  async function handleExport() {
    if (!result) return;
    setExporting(true);
    try {
      const resp = await fetch("/api/adaptations/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: result.content,
          script_name: result.script_name,
          adaptation_id: result.adaptation_id,
        }),
      });
      if (!resp.ok) {
        const data = await resp.json();
        setError(data.error || "导出失败");
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${result.script_name || "adapted"}_改编版.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("导出失败");
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <div className="p-4">加载中...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">
        <a href="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600 mb-3">← 返回大厅</a>
        <h1 className="text-xl font-bold mb-6">🎭 改编工坊</h1>

        {/* 改编表单 */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-bold mb-4">新建改编</h2>
          {error && <div className="mb-3 p-2 bg-red-50 text-red-600 text-sm rounded">{error}</div>}
          <form onSubmit={handlePreview} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">选择剧本 *</label>
              <select value={form.script_id} onChange={e => setForm({...form, script_id: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" required disabled={generating}>
                <option value="">选择剧本</option>
                {scripts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">改编类型 *</label>
              <select value={form.adaptation_type} onChange={e => setForm({...form, adaptation_type: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" disabled={generating}>
                {ADAPT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">改编指令 *</label>
              <textarea
                value={form.instruction} onChange={e => setForm({...form, instruction: e.target.value})}
                className="w-full px-3 py-2 border rounded-lg h-32 disabled:bg-gray-100"
                placeholder="描述你的改编需求，如：将死亡方式从刀杀改为毒杀，凶手动机不变，线索中刀相关证据改为毒相关证据"
                required
                disabled={generating}
              />
            </div>
            <button
              type="submit"
              disabled={generating}
              className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400"
            >
              {generating ? "🔄 AI分析中..." : "📋 生成改编方案"}
            </button>
          </form>
        </div>

        {/* 改编方案预览 */}
        {preview && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-bold mb-2">改编方案 — {preview.script_name}</h2>
            <div className="whitespace-pre-wrap text-sm mb-4">{preview.preview}</div>
            {preview.need_confirm && (
              <div className="p-3 bg-orange-100 text-orange-800 rounded-lg text-sm mb-4">
                ⚠️ {preview.confirm_message}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setPreview(null)} className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300">取消</button>
              <button onClick={handleGenerate} disabled={generating} className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:bg-gray-400">
                {generating ? "🔄 AI改编中..." : "✅ 确认并生成全本"}
              </button>
            </div>
          </div>
        )}

        {/* 改编结果 */}
        {result && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-bold mb-2">改编结果 — {result.script_name}</h2>
            {result.is_truncated && (
              <div className="mb-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm font-medium">
                {result.truncation_warning}
              </div>
            )}
            {showComparison ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-600 mb-2">原版剧本</h3>
                  <pre className="whitespace-pre-wrap text-xs bg-gray-100 p-3 rounded-lg max-h-[70vh] overflow-y-auto border border-gray-200">
                    {loadingOriginal ? "加载中..." : originalText || "（无法加载）"}
                  </pre>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-purple-600 mb-2">改编版本</h3>
                  <pre className="whitespace-pre-wrap text-xs bg-purple-50 p-3 rounded-lg max-h-[70vh] overflow-y-auto border border-purple-200">
                    {result.content}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="prose max-w-none">
                <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded-lg max-h-[70vh] overflow-y-auto">
                  {result.content}
                </pre>
              </div>
            )}
            <div className="flex gap-3 mt-3">
              <button onClick={() => { navigator.clipboard.writeText(result.content); alert("已复制到剪贴板"); }}
                className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 text-sm">复制结果</button>
              <button onClick={toggleComparison} disabled={loadingOriginal}
                className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-sm">
                {showComparison ? "收起对比" : loadingOriginal ? "加载中..." : "对比原版"}
              </button>
              <button onClick={handleExport} disabled={exporting}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 text-sm">
                {exporting ? "导出中..." : "导出 DOCX"}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-2">导出文件自动添加「改编版本 · 仅供内部使用」水印</p>
          </div>
        )}

        {/* 改编历史 */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-bold mb-4">改编历史</h2>
          <div className="space-y-3">
            {adaptations.map(a => (
              <div key={a.id} className="border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{a.script_name || "未知剧本"}</span>
                  <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                    {ADAPT_TYPE_LABELS[a.adaptation_type] || a.adaptation_type}
                  </span>
                  <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
                </div>
                <div className="text-sm text-gray-600">{a.instruction}</div>
              </div>
            ))}
            {adaptations.length === 0 && (
              <div className="text-center text-gray-400 py-6">暂无改编记录</div>
            )}
          </div>
        </div>

        {/* 版本历史 */}
        {form.script_id && (
          <div className="bg-white rounded-lg shadow p-6 mt-6">
            <h2 className="text-lg font-bold mb-4">版本历史</h2>

            {versionPreview && (
              <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">预览: {versionPreviewLabel}</span>
                  <button onClick={() => { setVersionPreview(null); setVersionPreviewLabel(""); }}
                    className="text-xs text-gray-500 hover:text-gray-700">关闭</button>
                </div>
                <pre className="whitespace-pre-wrap text-xs max-h-96 overflow-y-auto bg-white p-3 rounded border">
                  {versionPreview}
                </pre>
              </div>
            )}

            <div className="space-y-2">
              {versions.map(v => (
                <div key={v.id} className="flex items-center gap-3 border rounded-lg px-4 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{v.label}</span>
                      <span className={`px-1.5 py-0.5 text-xs rounded ${
                        v.source === 'original' ? 'bg-gray-100 text-gray-600' :
                        v.source === 'adapted' ? 'bg-purple-100 text-purple-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        {v.source === 'original' ? '原版' : v.source === 'adapted' ? '改编' : '恢复'}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 truncate">
                      {v.preview}...
                    </div>
                    <div className="text-xs text-gray-400">
                      {new Date(v.created_at).toLocaleString()} · {(v.content_length / 1024).toFixed(1)}KB
                    </div>
                  </div>
                  <button
                    onClick={() => previewVersion(v.id)}
                    className="px-3 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                  >预览</button>
                  <button
                    onClick={() => restoreVersion(v.id)}
                    disabled={restoring}
                    className="px-3 py-1 text-xs bg-green-50 text-green-600 rounded hover:bg-green-100 disabled:opacity-50"
                  >恢复</button>
                </div>
              ))}
              {versions.length === 0 && (
                <div className="text-center text-gray-400 py-6">选择剧本查看版本历史 · 每次改编自动保存版本</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
