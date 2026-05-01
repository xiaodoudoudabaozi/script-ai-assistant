"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface User {
  id: string;
  name: string;
  role: string;
  phone?: string;
  position?: string;
}

export default function MePage() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", position: "", password: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const userData = localStorage.getItem("user");
    if (!userData) {
      router.push("/");
      return;
    }
    let u; try { u = JSON.parse(userData); } catch { return; }
    setUser(u);
    setForm({ name: u.name, phone: u.phone || "", position: u.position || "", password: "" });
    setLoading(false);
  }, []);

  // 页面可见时刷新用户数据
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        const userData = localStorage.getItem("user");
        if (userData) {
          let u; try { u = JSON.parse(userData); } catch { return; }
          setUser(u);
          if (!editing) setForm({ name: u.name, phone: u.phone || "", position: u.position || "", password: "" });
        }
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [editing]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSaving(true);

    const userData = localStorage.getItem("user");
    try {
      const resp = await fetch(`/api/employees/${user!.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-user-data": userData || ""
        },
        body: JSON.stringify(form)
      });
      const data = await resp.json();
      if (resp.ok) {
        const updatedUser = { ...user!, ...form };
        delete (updatedUser as any).password;
        localStorage.setItem("user", JSON.stringify(updatedUser));
        setUser(updatedUser);
        setSuccess("保存成功");
        setEditing(false);
        setForm({ ...form, password: "" });
      } else {
        setError(data.error || "保存失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-4">加载中...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-md mx-auto">
        <a href="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600 mb-3">← 返回大厅</a>
        <h1 className="text-xl font-bold mb-6">个人信息</h1>

        {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg">{error}</div>}
        {success && <div className="mb-4 p-3 bg-green-50 text-green-600 rounded-lg">{success}</div>}

        <div className="bg-white rounded-lg shadow p-6">
          {!editing ? (
            <>
              <div className="space-y-4">
                <div>
                  <div className="text-sm text-gray-500">姓名</div>
                  <div className="text-lg font-medium">{user?.name}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">职位</div>
                  <div className="text-lg font-medium">{user?.position || "-"}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">电话</div>
                  <div className="text-lg font-medium">{user?.phone || "-"}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">角色</div>
                  <div className="text-lg font-medium">{user?.role === "admin" ? "管理员" : "员工"}</div>
                </div>
              </div>
              <button
                onClick={() => setEditing(true)}
                className="mt-6 w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                修改信息
              </button>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">姓名</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100"
                  required
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">职位</label>
                <input
                  type="text"
                  value={form.position}
                  onChange={e => setForm({...form, position: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">电话</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={e => setForm({...form, phone: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">新密码（不修改留空）</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm({...form, password: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100"
                  placeholder="只填写要修改的密码"
                  disabled={saving}
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setEditing(false); setForm({ name: user!.name, phone: user!.phone || "", position: user!.position || "", password: "" }); }}
                  className="flex-1 px-4 py-2 bg-gray-100 rounded-lg disabled:opacity-50"
                  disabled={saving}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg disabled:bg-gray-400"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}