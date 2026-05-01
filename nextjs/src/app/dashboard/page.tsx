"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const u = localStorage.getItem("user");
    if (!u) { router.push("/"); return; }
    let user; try { user = JSON.parse(u); } catch { router.push("/"); return; }
    if (user.role !== "admin") { router.push("/"); return; }

    fetch("/api/dashboard")
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const maxTrend = data?.dailyTrend?.length
    ? Math.max(...data.dailyTrend.map((d: any) => d.count), 1)
    : 1;

  if (loading) return <div className="p-8 text-center text-gray-400">加载中...</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-5xl mx-auto">
        <a href="/" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600 mb-3">← 返回大厅</a>
        <h1 className="text-xl font-bold mb-6">📊 数据仪表盘</h1>

        {/* 概览卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <StatCard label="本月问答" value={data?.stats?.monthlyQuestions} color="blue" />
          <StatCard label="活跃员工" value={data?.stats?.activeUsers} color="green" />
          <StatCard label="剧本总数" value={data?.stats?.totalScripts} color="purple" />
          <StatCard label="员工总数" value={data?.stats?.totalEmployees} color="orange" />
          <StatCard label="本月改编" value={data?.stats?.monthlyAdaptations} color="pink" />
          <StatCard label="本月登录" value={data?.stats?.monthlyLogins} color="gray" />
        </div>

        {/* 热门剧本 + 趋势 */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow p-5">
            <h2 className="font-bold text-sm mb-3">热门剧本 Top 5</h2>
            {(data?.topScripts || []).length === 0 ? (
              <div className="text-gray-400 text-sm py-6 text-center">本月暂无数据</div>
            ) : (
              <div className="space-y-2">
                {(data?.topScripts || []).map((s: any, i: number) => (
                  <div key={s.name} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-400 w-5">#{i + 1}</span>
                    <span className="flex-1 text-sm truncate">{s.name}</span>
                    <span className="text-xs text-gray-500">{s.count} 问</span>
                    <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(s.count / (data?.topScripts[0]?.count || 1)) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow p-5">
            <h2 className="font-bold text-sm mb-3">每日趋势 ({data?.thisMonth})</h2>
            {(data?.dailyTrend || []).length === 0 ? (
              <div className="text-gray-400 text-sm py-6 text-center">本月暂无数据</div>
            ) : (
              <div className="flex items-end gap-1 h-40">
                {(data?.dailyTrend || []).map((d: any) => (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs text-gray-500">{d.count || 0}</span>
                    <div
                      className="w-full bg-blue-400 rounded-t min-h-[4px]"
                      style={{ height: `${(d.count / maxTrend) * 100}%` }}
                      title={`${d.day}: ${d.count} 问`}
                    />
                    <span className="text-[10px] text-gray-400">{d.day.slice(3)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | undefined; color: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    purple: "bg-purple-50 text-purple-700",
    orange: "bg-orange-50 text-orange-700",
    pink: "bg-pink-50 text-pink-700",
    gray: "bg-gray-100 text-gray-700",
  };
  return (
    <div className={`rounded-lg p-3 text-center ${colors[color]}`}>
      <div className="text-2xl font-bold">{value ?? "-"}</div>
      <div className="text-xs mt-1 opacity-70">{label}</div>
    </div>
  );
}
