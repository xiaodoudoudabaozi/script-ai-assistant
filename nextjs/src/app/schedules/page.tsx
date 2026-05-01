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

interface Employee {
  id: string;
  name: string;
  position?: string;
}

interface Schedule {
  id: string;
  employee_id: string;
  employee_name: string;
  position?: string;
  date: string;
  shift: string;
  role_in_shift: string;
  note?: string;
}

const SHIFTS = [
  { value: "上午", label: "上午", color: "bg-yellow-100 text-yellow-800" },
  { value: "下午", label: "下午", color: "bg-blue-100 text-blue-800" },
  { value: "全天", label: "全天", color: "bg-green-100 text-green-800" },
  { value: "晚班", label: "晚班", color: "bg-purple-100 text-purple-800" },
];

function getShiftColor(shift: string) {
  return SHIFTS.find(s => s.value === shift)?.color || "bg-gray-100 text-gray-800";
}

export default function SchedulesPage() {
  const [user, setUser] = useState<User | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    employee_id: "",
    date: "",
    shift: "全天",
    role_in_shift: "",
    note: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const router = useRouter();

  useEffect(() => {
    const userData = localStorage.getItem("user");
    if (!userData) { router.push("/"); return; }
    let u; try { u = JSON.parse(userData); } catch { return; }
    setUser(u);
  }, []);

  useEffect(() => {
    if (user) {
      fetchSchedules();
      if (user.role === "admin") fetchEmployees();
    }
  }, [user, currentMonth]);

  async function fetchSchedules() {
    try {
      setError("");
      const userData = localStorage.getItem("user");
      const resp = await fetch(`/api/schedules?month=${currentMonth}`, {
        headers: { "x-user-data": userData || "" },
      });
      const data = await resp.json();
      if (resp.ok) setSchedules(data.schedules || []);
      else setError(data.error || "加载排班失败");
    } catch { setError("加载排班失败"); }
    finally { setLoading(false); }
  }

  async function fetchEmployees() {
    try {
      const userData = localStorage.getItem("user");
      const resp = await fetch("/api/employees", {
        headers: { "x-user-data": userData || "" },
      });
      const data = await resp.json();
      if (resp.ok) setEmployees(data.employees || []);
    } catch { /* ignore - 员工列表加载失败不影响排班查看 */ }
  }

  // 页面可见时刷新
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible" && user) fetchSchedules(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [user, currentMonth]);

  async function handleAddSchedule(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const userData = localStorage.getItem("user");
    try {
      const resp = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-data": userData || "" },
        body: JSON.stringify(addForm),
      });
      if (resp.ok) {
        setShowAddModal(false);
        setAddForm({ employee_id: "", date: "", shift: "全天", role_in_shift: "", note: "" });
        fetchSchedules();
      } else {
        const data = await resp.json();
        setError(data.error || "添加失败");
      }
    } catch { setError("网络错误"); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("确定删除该排班？")) return;
    setDeleting(prev => new Set(prev).add(id));
    setError("");
    const userData = localStorage.getItem("user");
    try {
      const resp = await fetch(`/api/schedules/${id}`, {
        method: "DELETE",
        headers: { "x-user-data": userData || "" },
      });
      if (resp.ok) fetchSchedules();
      else { const data = await resp.json(); setError(data.error || "删除失败"); }
    } catch { setError("删除失败"); }
    finally { setDeleting(prev => { const next = new Set(prev); next.delete(id); return next; }); }
  }

  // 按日期分组排班
  const groupedByDate = schedules.reduce<Record<string, Schedule[]>>((acc, s) => {
    if (!acc[s.date]) acc[s.date] = [];
    acc[s.date].push(s);
    return acc;
  }, {});

  // 生成当月日期列表
  const [year, month] = currentMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthDates = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    return `${currentMonth}-${String(d).padStart(2, "0")}`;
  });

  const weekDays = ["日", "一", "二", "三", "四", "五", "六"];

  const now = new Date();
  const currentYearMonth = now.getFullYear() * 12 + now.getMonth();
  const viewYearMonth = (() => { const [y, m] = currentMonth.split("-").map(Number); return y * 12 + m - 1; })();
  const canGoPrev = viewYearMonth > currentYearMonth - 12;
  const canGoNext = viewYearMonth < currentYearMonth + 12;

  function prevMonth() {
    if (!canGoPrev) return;
    const [y, m] = currentMonth.split("-").map(Number);
    const nm = m === 1 ? 12 : m - 1;
    const ny = m === 1 ? y - 1 : y;
    setCurrentMonth(`${ny}-${String(nm).padStart(2, "0")}`);
  }

  function nextMonth() {
    if (!canGoNext) return;
    const [y, m] = currentMonth.split("-").map(Number);
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    setCurrentMonth(`${ny}-${String(nm).padStart(2, "0")}`);
  }

  if (loading) return <div className="p-4">加载中...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-4xl mx-auto">
        {/* 月份切换 */}
        <div className="flex items-center justify-between mb-4">
          <a href="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600 mb-3">← 返回大厅</a>
          <h1 className="text-xl font-bold">排班表</h1>
          <div className="flex items-center gap-3">
            <button onClick={prevMonth} disabled={!canGoPrev} className="px-3 py-1 bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">◀</button>
            <span className="font-medium">{currentMonth}</span>
            <button onClick={nextMonth} disabled={!canGoNext} className="px-3 py-1 bg-white border rounded-lg hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">▶</button>
            {user?.role === "admin" && (
              <button onClick={() => setShowAddModal(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                + 排班
              </button>
            )}
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

        {/* 日历视图 */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="grid grid-cols-7 bg-gray-50">
            {weekDays.map(d => (
              <div key={d} className="p-2 text-center text-sm font-medium text-gray-500">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {/* 第一天偏移 */}
            {Array.from({ length: new Date(year, month - 1, 1).getDay() }, (_, i) => (
              <div key={`empty-${i}`} className="min-h-[80px] border-t border-r p-1 bg-gray-50" />
            ))}
            {monthDates.map(dateStr => {
              const daySchedules = groupedByDate[dateStr] || [];
              const dayNum = parseInt(dateStr.split("-")[2]);
              const isToday = dateStr === new Date().toISOString().split("T")[0];

              return (
                <div key={dateStr} className={`min-h-[80px] border-t border-r p-1 ${isToday ? "bg-blue-50" : ""}`}>
                  <div className={`text-xs font-medium mb-1 ${isToday ? "text-blue-600" : "text-gray-500"}`}>{dayNum}</div>
                  {daySchedules.map(s => (
                    <div key={s.id} className={`text-xs px-1 py-0.5 rounded mb-0.5 ${getShiftColor(s.shift)}`}>
                      <span className="font-medium">{s.shift}</span>
                      <span className="ml-1">{s.employee_name}</span>
                      {user?.role === "admin" && (
                        <button onClick={() => handleDelete(s.id)} disabled={deleting.has(s.id)} className="ml-1 text-red-400 hover:text-red-600 disabled:opacity-30">{deleting.has(s.id) ? "..." : "×"}</button>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* 列表视图（员工视角更直观） */}
        {user?.role !== "admin" && (
          <div className="mt-6">
            <h2 className="text-lg font-bold mb-3">我的排班</h2>
            <div className="space-y-2">
              {schedules
                .filter(s => s.employee_id === user?.id)
                .sort((a, b) => a.date.localeCompare(b.date))
                .map(s => (
                  <div key={s.id} className="bg-white p-3 rounded-lg shadow flex items-center gap-3">
                    <div className="text-sm font-medium w-20">{s.date}</div>
                    <span className={`px-2 py-1 text-xs rounded ${getShiftColor(s.shift)}`}>{s.shift}</span>
                    {s.role_in_shift && <span className="text-xs text-gray-500">{s.role_in_shift}</span>}
                    {s.note && <span className="text-xs text-gray-400">({s.note})</span>}
                  </div>
                ))}
              {schedules.filter(s => s.employee_id === user?.id).length === 0 && (
                <div className="text-center text-gray-400 py-8">本月暂无排班</div>
              )}
            </div>
          </div>
        )}

        {/* 添加排班弹窗 */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
              <h2 className="text-lg font-bold mb-4">添加排班</h2>
              {error && <div className="mb-3 p-2 bg-red-50 text-red-600 text-sm rounded">{error}</div>}
              <form onSubmit={handleAddSchedule} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">员工 *</label>
                  <select value={addForm.employee_id} onChange={e => setAddForm({...addForm, employee_id: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" required disabled={saving}>
                    <option value="">选择员工</option>
                    {employees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name} {emp.position ? `(${emp.position})` : ""}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">日期 *</label>
                  <input type="date" value={addForm.date} onChange={e => setAddForm({...addForm, date: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" required disabled={saving} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">班次 *</label>
                  <select value={addForm.shift} onChange={e => setAddForm({...addForm, shift: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" disabled={saving}>
                    {SHIFTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">班次角色</label>
                  <input type="text" value={addForm.role_in_shift} onChange={e => setAddForm({...addForm, role_in_shift: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" placeholder="如：DM、NPC、前台" disabled={saving} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                  <input type="text" value={addForm.note} onChange={e => setAddForm({...addForm, note: e.target.value})} className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-100" disabled={saving} />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowAddModal(false)} disabled={saving} className="flex-1 px-4 py-2 bg-gray-100 rounded-lg disabled:opacity-50">取消</button>
                  <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg disabled:bg-gray-400">{saving ? "保存中..." : "保存"}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}