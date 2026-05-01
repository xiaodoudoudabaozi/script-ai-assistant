"use client";

import { useState, useEffect } from "react";

interface Script { id: string; name: string; genre?: string; player_count?: string; difficulty?: string; }
interface Schedule { id: string; employee_name: string; date: string; shift: string; role_in_shift: string; }

export default function KioskPage() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [time, setTime] = useState("");
  const [tab, setTab] = useState<"scripts" | "schedules">("scripts");

  useEffect(() => {
    setTime(new Date().toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", month: "long", day: "numeric", weekday: "long" }));
    const t = setInterval(() => {
      setTime(new Date().toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit", month: "long", day: "numeric", weekday: "long" }));
    }, 60000);

    fetch("/api/scripts/list").then(r => r.json()).then(d => setScripts(d.scripts || [])).catch(() => {});
    // 获取今日排班
    const today = new Date().toISOString().slice(0, 10);
    fetch(`/api/schedules?month=${today.slice(0, 7)}`).then(r => r.json()).then(d => {
      setSchedules((d.schedules || []).filter((s: any) => s.date === today));
    }).catch(() => {});

    return () => clearInterval(t);
  }, []);

  // 自动轮播
  useEffect(() => {
    const interval = setInterval(() => {
      setTab(prev => prev === "scripts" ? "schedules" : "scripts");
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* 顶部 */}
      <div className="flex items-center justify-between px-8 py-6 border-b border-gray-700">
        <h1 className="text-2xl font-bold">剧本杀AI店员助手</h1>
        <div className="text-right">
          <div className="text-3xl font-mono">{time.slice(-5)}</div>
          <div className="text-sm text-gray-400">{time.slice(0, -6)}</div>
        </div>
      </div>

      {/* tab切换 */}
      <div className="flex gap-2 px-8 py-4">
        <button onClick={() => setTab("scripts")}
          className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "scripts" ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}>
          剧本库 ({scripts.length})
        </button>
        <button onClick={() => setTab("schedules")}
          className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors ${tab === "schedules" ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}>
          今日排班 ({schedules.length})
        </button>
      </div>

      {/* 内容区 */}
      <div className="px-8 py-4">
        {tab === "scripts" && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {scripts.map(s => (
              <div key={s.id} className="bg-gray-800 border border-gray-700 rounded-xl p-5 hover:border-blue-500 transition-colors">
                <div className="text-lg font-bold mb-2 truncate">{s.name}</div>
                <div className="flex flex-wrap gap-1.5">
                  {s.genre && <span className="px-2 py-0.5 text-xs bg-purple-700 rounded">{s.genre}</span>}
                  {s.player_count && <span className="px-2 py-0.5 text-xs bg-blue-700 rounded">{s.player_count}人</span>}
                  {s.difficulty && <span className="px-2 py-0.5 text-xs bg-orange-700 rounded">{s.difficulty}</span>}
                </div>
              </div>
            ))}
            {scripts.length === 0 && (
              <div className="col-span-full text-center text-gray-500 py-20 text-lg">暂无剧本，联系管理员录入</div>
            )}
          </div>
        )}

        {tab === "schedules" && (
          <div>
            {schedules.length === 0 ? (
              <div className="text-center text-gray-500 py-20 text-lg">今日暂无排班</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {schedules.map(s => (
                  <div key={s.id} className={`rounded-xl p-5 border ${
                    s.shift === "上午" ? "bg-yellow-900/30 border-yellow-700" :
                    s.shift === "下午" ? "bg-blue-900/30 border-blue-700" :
                    s.shift === "全天" ? "bg-green-900/30 border-green-700" :
                    "bg-purple-900/30 border-purple-700"
                  }`}>
                    <div className="text-lg font-bold mb-1">{s.employee_name}</div>
                    <div className="text-sm text-gray-300">{s.shift} · {s.role_in_shift}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 自动轮播指示器 */}
        <div className="flex justify-center gap-1 mt-8">
          <div className={`w-2 h-2 rounded-full ${tab === "scripts" ? "bg-blue-500" : "bg-gray-600"}`} />
          <div className={`w-2 h-2 rounded-full ${tab === "schedules" ? "bg-blue-500" : "bg-gray-600"}`} />
        </div>
      </div>
    </div>
  );
}
