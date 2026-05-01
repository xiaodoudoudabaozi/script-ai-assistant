"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Employee {
  id: string;
  name: string;
  role: string;
  phone: string;
  position: string;
  created_at: string;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", position: "", password: "", role: "staff" });
  const [formTouched, setFormTouched] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("token");
    const userData = localStorage.getItem("user");
    if (!token || !userData) {
      router.push("/");
      return;
    }
    let user; try { user = JSON.parse(userData); } catch { router.push("/"); return; }
    if (user.role !== "admin") {
      router.push("/");
      return;
    }
    fetchEmployees();
  }, []);

  // 页面可见时刷新
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") fetchEmployees(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  async function fetchEmployees() {
    try {
      const userData = localStorage.getItem("user");
      const resp = await fetch("/api/employees", {
        headers: { "x-user-data": userData || "" }
      });
      const data = await resp.json();
      if (resp.ok) {
        setEmployees(data.employees || []);
      } else {
        setError(data.error || "加载失败");
      }
    } catch (e) {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const userData = localStorage.getItem("user");
    const url = editingEmployee ? `/api/employees/${editingEmployee.id}` : "/api/employees";
    const method = editingEmployee ? "PUT" : "POST";

    try {
      const resp = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-user-data": userData || ""
        },
        body: JSON.stringify(form)
      });
      if (resp.ok) {
        setShowModal(false);
        setEditingEmployee(null);
        setFormTouched(false);
        setForm({ name: "", phone: "", position: "", password: "", role: "staff" });
        fetchEmployees();
      } else {
        const data = await resp.json();
        setError(data.error || "操作失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("确定删除该员工？")) return;
    setDeleting(prev => new Set(prev).add(id));
    setError("");
    const userData = localStorage.getItem("user");
    try {
      const resp = await fetch(`/api/employees/${id}`, {
        method: "DELETE",
        headers: { "x-user-data": userData || "" }
      });
      if (resp.ok) {
        fetchEmployees();
      } else {
        const data = await resp.json();
        setError(data.error || "删除失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setDeleting(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  }

  function openEdit(employee: Employee) {
    setEditingEmployee(employee);
    setForm({ name: employee.name, phone: employee.phone || "", position: employee.position || "", password: "", role: employee.role });
    setFormTouched(false);
    setError("");
    setShowModal(true);
  }

  if (loading) return <div className="p-4">加载中...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <a href="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600 mb-3">← 返回大厅</a>
          <h1 className="text-xl font-bold">员工管理</h1>
          <button
            onClick={() => { setEditingEmployee(null); setForm({ name: "", phone: "", position: "", password: "", role: "staff" }); setFormTouched(false); setError(""); setShowModal(true); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + 添加员工
          </button>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg">{error}</div>}

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">姓名</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">职位</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">电话</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">角色</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id} className="border-t">
                  <td className="px-4 py-3">{emp.name}</td>
                  <td className="px-4 py-3">{emp.position || "-"}</td>
                  <td className="px-4 py-3">{emp.phone || "-"}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 text-xs rounded ${emp.role === "admin" ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-700"}`}>
                      {emp.role === "admin" ? "管理员" : "员工"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(emp)} disabled={deleting.has(emp.id)} className="text-blue-600 hover:underline mr-3 disabled:opacity-50">编辑</button>
                    <button onClick={() => handleDelete(emp.id)} disabled={deleting.has(emp.id)} className="text-red-600 hover:underline disabled:opacity-50">{deleting.has(emp.id) ? "删除中..." : "删除"}</button>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">暂无员工</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 添加/编辑弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-bold mb-4">{editingEmployee ? "编辑员工" : "添加员工"}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">姓名 *</label>
                <input type="text" value={form.name} onChange={e => { setForm({...form, name: e.target.value}); setFormTouched(true); }} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" required disabled={saving} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">职位</label>
                <input type="text" value={form.position} onChange={e => { setForm({...form, position: e.target.value}); setFormTouched(true); }} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" placeholder="如：DM、前台、店长" disabled={saving} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">电话</label>
                <input type="tel" value={form.phone} onChange={e => { setForm({...form, phone: e.target.value}); setFormTouched(true); }} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" disabled={saving} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{editingEmployee ? "新密码（不修改留空）" : "密码 *"}</label>
                <input type="password" value={form.password} onChange={e => { setForm({...form, password: e.target.value}); setFormTouched(true); }} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" {...(editingEmployee ? {} : {required: true})} disabled={saving} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">角色</label>
                <select value={form.role} onChange={e => { setForm({...form, role: e.target.value}); setFormTouched(true); }} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" disabled={saving}>
                  <option value="staff">员工</option>
                  <option value="admin">管理员</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { if (formTouched && !confirm("有未保存的更改，确定关闭？")) return; setShowModal(false); }} className="flex-1 px-4 py-2 bg-gray-100 rounded-lg disabled:opacity-50" disabled={saving}>取消</button>
                <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg disabled:bg-gray-400">{saving ? "保存中..." : "保存"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}