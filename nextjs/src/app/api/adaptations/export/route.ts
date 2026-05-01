/**
 * POST /api/adaptations/export
 *
 * 导出改编内容为 DOCX（规格文档4.2.3节步骤⑦）
 * 自动添加「改编版本 · 仅供内部使用」水印
 */

import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/pg";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Header,
  AlignmentType,
} from "docx";

function getUser(req: NextRequest) {
  const h = req.headers.get("x-user-data");
  if (!h) return null;
  try { return JSON.parse(h); } catch { return null; }
}

export async function POST(request: NextRequest) {
  try {
    const user = getUser(request);
    if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
    if (user.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });

    const { content, script_name, adaptation_id } = await request.json();

    if (!content) {
      return NextResponse.json({ error: "改编内容不能为空" }, { status: 400 });
    }

    // 生成含水印的 DOCX
    const doc = new Document({
      sections: [
        {
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: "改编版本 · 仅供内部使用",
                      color: "CC0000",
                      size: 22,
                      bold: true,
                    }),
                  ],
                }),
              ],
            }),
          },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: script_name ? `《${script_name}》改编版本` : "改编版本",
                  bold: true,
                  size: 28,
                }),
              ],
            }),
            new Paragraph({ children: [] }),
            ...content
              .split("\n")
              .map(
                (line: string) =>
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: line || " ",
                        size: 21,
                      }),
                    ],
                  })
              ),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    // 更新改编日志的文件路径
    if (adaptation_id) {
      await pool
        .query(
          `UPDATE adaptation_logs SET output_file_path = $1 WHERE id = $2`,
          [`exports/${script_name || "unknown"}_adapted.docx`, adaptation_id]
        )
        .catch(() => {});
    }

    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${encodeURIComponent((script_name || 'adapted') + '_改编版')}.docx"`,
      },
    });
  } catch (error) {
    console.error("导出改编失败:", error);
    return NextResponse.json({ error: "导出失败" }, { status: 500 });
  }
}
