import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  dayHeadline,
  daysBetween,
  endOfMonth,
  endOfWeek,
  enumerateDays,
  formatBrDate,
  formatShortDay,
  isIsoDate,
  isWeekend,
  rangeForScope,
  scopeHeadline,
  shiftCursor,
  startOfMonth,
  startOfWeek,
  todayInSaoPaulo,
} from "./notepadDates";

describe("todayInSaoPaulo", () => {
  it("usa o dia de São Paulo, não o dia UTC", () => {
    // 03:00Z de 26/08 ainda é 25/08 às 00:00 em São Paulo (UTC-3). É o caso do
    // agente do turno da noite: a anotação tem que cair na página de 25.
    expect(todayInSaoPaulo(new Date("2026-08-26T02:59:00Z"))).toBe("2026-08-25");
    expect(todayInSaoPaulo(new Date("2026-08-26T03:00:00Z"))).toBe("2026-08-26");
  });
});

describe("isIsoDate", () => {
  it("aceita data de calendário e recusa o resto", () => {
    expect(isIsoDate("2026-08-25")).toBe(true);
    expect(isIsoDate("2026-02-31")).toBe(false); // dia que não existe
    expect(isIsoDate("25/08/2026")).toBe(false);
    expect(isIsoDate("")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe("addDays", () => {
  it("atravessa mês e ano", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("não escorrega no horário de verão", () => {
    // Fev/2028 é bissexto; a conta é em UTC, então 28 + 1 = 29.
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("addMonths", () => {
  it("ancora no último dia quando o mês de destino é mais curto", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("mantém o dia quando ele existe no destino", () => {
    expect(addMonths("2026-08-25", 1)).toBe("2026-09-25");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });
});

describe("semana", () => {
  it("começa na segunda e termina no domingo", () => {
    // 2026-08-25 é uma terça-feira.
    expect(startOfWeek("2026-08-25")).toBe("2026-08-24");
    expect(endOfWeek("2026-08-25")).toBe("2026-08-30");
  });

  it("domingo pertence à semana que começou na segunda anterior", () => {
    expect(startOfWeek("2026-08-30")).toBe("2026-08-24");
    expect(endOfWeek("2026-08-30")).toBe("2026-08-30");
  });

  it("segunda é o próprio início", () => {
    expect(startOfWeek("2026-08-24")).toBe("2026-08-24");
  });
});

describe("mês", () => {
  it("delimita o mês corrente", () => {
    expect(startOfMonth("2026-08-25")).toBe("2026-08-01");
    expect(endOfMonth("2026-08-25")).toBe("2026-08-31");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
  });
});

describe("rangeForScope", () => {
  it("dia é um intervalo de um dia só", () => {
    expect(rangeForScope("dia", "2026-08-25")).toEqual({
      from: "2026-08-25",
      to: "2026-08-25",
    });
  });

  it("semana e mês cobrem o recorte inteiro", () => {
    expect(rangeForScope("semana", "2026-08-25")).toEqual({
      from: "2026-08-24",
      to: "2026-08-30",
    });
    expect(rangeForScope("mes", "2026-08-25")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });
});

describe("shiftCursor", () => {
  it("passa a página conforme o recorte", () => {
    expect(shiftCursor("dia", "2026-08-25", 1)).toBe("2026-08-26");
    expect(shiftCursor("dia", "2026-08-25", -1)).toBe("2026-08-24");
    expect(shiftCursor("semana", "2026-08-25", 1)).toBe("2026-09-01");
    expect(shiftCursor("semana", "2026-08-25", -1)).toBe("2026-08-18");
    expect(shiftCursor("mes", "2026-08-25", 1)).toBe("2026-09-25");
    expect(shiftCursor("mes", "2026-08-31", 1)).toBe("2026-09-30");
  });
});

describe("enumerateDays", () => {
  it("inclui as duas pontas", () => {
    expect(enumerateDays("2026-08-24", "2026-08-30")).toHaveLength(7);
    expect(enumerateDays("2026-08-25", "2026-08-25")).toEqual(["2026-08-25"]);
  });

  it("devolve vazio quando o fim é antes do início", () => {
    expect(enumerateDays("2026-08-30", "2026-08-24")).toEqual([]);
  });
});

describe("daysBetween", () => {
  it("conta dias inteiros com sinal", () => {
    expect(daysBetween("2026-08-25", "2026-08-28")).toBe(3);
    expect(daysBetween("2026-08-28", "2026-08-25")).toBe(-3);
    expect(daysBetween("2026-08-25", "2026-08-25")).toBe(0);
  });
});

describe("rótulos", () => {
  it("dayHeadline é relativo perto de hoje e absoluto longe", () => {
    expect(dayHeadline("2026-08-25", "2026-08-25")).toBe("Hoje");
    expect(dayHeadline("2026-08-24", "2026-08-25")).toBe("Ontem");
    expect(dayHeadline("2026-08-26", "2026-08-25")).toBe("Amanhã");
    // Fora da janela relativa vira data por extenso, na mesma caixa de "Hoje".
    expect(dayHeadline("2026-08-20", "2026-08-25")).toBe("Quinta-feira, 20 de agosto");
  });

  it("formata a data no padrão brasileiro sem escorregar de fuso", () => {
    expect(formatBrDate("2026-08-25")).toBe("25/08/2026");
    expect(formatBrDate("2026-01-01")).toBe("01/01/2026");
  });

  it("formatShortDay tira os pontos e sobe só a primeira letra", () => {
    expect(formatShortDay("2026-08-28")).toBe("Sex, 28 de ago");
  });

  it("scopeHeadline resume semana e mês", () => {
    expect(scopeHeadline("semana", "2026-08-25", "2026-08-25")).toBe("24 – 30 de agosto");
    // Só o mês: o ano fica na legenda (scopeSubtitle), sem repetir.
    expect(scopeHeadline("mes", "2026-08-25", "2026-08-25")).toBe("Agosto");
  });

  it("semana virando o mês mostra os dois meses", () => {
    // 31/08/2026 é segunda; a semana termina em 06/09.
    expect(scopeHeadline("semana", "2026-09-02", "2026-08-25")).toBe(
      "31 de ago – 06 de setembro",
    );
  });
});

describe("isWeekend", () => {
  it("marca sábado e domingo", () => {
    expect(isWeekend("2026-08-29")).toBe(true); // sábado
    expect(isWeekend("2026-08-30")).toBe(true); // domingo
    expect(isWeekend("2026-08-28")).toBe(false); // sexta
    expect(isWeekend("2026-08-24")).toBe(false); // segunda
  });
});
