import { beforeEach, describe, expect, it, vi } from "vitest";

// Intercepta a escrita do arquivo: o teste inspeciona a planilha em memória.
const writeFile = vi.hoisted(() => vi.fn());
vi.mock("xlsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, writeFile };
});

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import * as XLSX from "xlsx";

import { exportAgentServicesSummary } from "./reportExport";

describe("exportAgentServicesSummary", () => {
  beforeEach(() => {
    writeFile.mockClear();
    rpc.mockReset();
  });

  it("chama a RPC de resumo e gera só as colunas liberadas pelo Jurídico", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: "svc-1",
          service_date: "2026-10-01T10:00:00",
          created_at: "2026-10-01T13:05:00Z",
          channel: "Email",
          product: "Presgera",
          platform: "Clickbank",
          contact_reason: "reembolso",
          status: "em_andamento",
          follow_up_count: 2,
          last_follow_up_status: "concluido",
        },
      ],
      error: null,
    });

    const count = await exportAgentServicesSummary({ fromISO: "2026-10-01", toISO: "2026-10-31" });

    expect(count).toBe(1);
    expect(rpc).toHaveBeenCalledWith("export_agent_services_summary", {
      p_from: "2026-10-01",
      p_to: "2026-10-31",
    });

    const wb = writeFile.mock.calls[0][0] as XLSX.WorkBook;
    expect(wb.SheetNames).toEqual(["Resumo"]);
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Resumo, { header: 1 });
    expect(rows[4]).toEqual([
      "Data de abertura",
      "Hora",
      "Canal",
      "Produto",
      "Plataforma",
      "Motivo de contato",
      "Status",
      "ID interno",
    ]);
    expect(rows[5][0]).toBe("01/10/2026");
    expect(rows[5][6]).toBe("Concluído");
    expect(rows[5][7]).toBe("svc-1");
    expect(JSON.stringify(rows)).not.toMatch(/e-mail/i);
  });
});
