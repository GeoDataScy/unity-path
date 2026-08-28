import type { CopyRefundAnalytics } from "@/features/copy/types";

/**
 * Recorte real de produção (01/06/2026–17/08/2026, 1.348 reembolsos concluídos),
 * reduzido a 4 motivos e 3 produtos. Serve para o teste de render exercitar os
 * mesmos formatos que a tela recebe do banco — inclusive `share`/`lift` nulos.
 */
export const analyticsFixture: CopyRefundAnalytics = {
  "cotacao": {
    "usd_brl": 5.4,
    "atualizada_em": "2026-08-28T13:00:00-03:00"
  },
  "kpis": {
    "dias_mediano": 4,
    "retencao_pct": 26.4,
    "devolvido_pct": 73.6,
    "valor_pedidos": 452083.47,
    "valor_devolvido": 332628.65,
    "ticket_medio_pedido": 335.37
  },
  "period": {
    "to": "2026-08-17",
    "days": 78,
    "from": "2026-06-01",
    "prev_to": "2026-05-31",
    "prev_from": "2026-03-15"
  },
  "filters": {
    "channels": [
      "Clickbank",
      "Email",
      "Não informado",
      "SMS"
    ],
    "products": [
      "Alphacur",
      "Alpharock",
      "Arialief",
      "Biografa",
      "Blinzador",
      "Cetacondor",
      "Clear Gaze",
      "Cognivex",
      "Erectozyn",
      "Feilaira",
      "FlowStrong",
      "Garaherb",
      "Gluco Mild",
      "Gluco Off",
      "Goldenfrib",
      "Honeyfil",
      "Horsefil",
      "Jertaris",
      "Karylief",
      "Kymezol",
      "Laellium",
      "Mahgryn",
      "Memoryon",
      "Memyts",
      "Mind Wake",
      "Nad Dermal+",
      "NATHUREX",
      "NerveEase",
      "Nexburn",
      "Presgera",
      "Quiet Nerves",
      "Shapeon",
      "Steelpower",
      "Tenurima",
      "VIP.Shipping",
      "VisualEase",
      "Xelovita"
    ],
    "platforms": [
      "Buygoods",
      "CartCandy",
      "Cartpanda",
      "ClickBank",
      "Digistore24",
      "LogiCall",
      "Nenhum",
      "SalesBound"
    ]
  },
  "monthly": [
    {
      "n": 540,
      "month": "2026-06",
      "order_value": 239042.37,
      "refunded_value": 197922.39
    },
    {
      "n": 535,
      "month": "2026-07",
      "order_value": 142083.91,
      "refunded_value": 89845.82
    },
    {
      "n": 273,
      "month": "2026-08",
      "order_value": 70957.19,
      "refunded_value": 44860.44
    }
  ],
  "universe": {
    "em_aberto": 437,
    "concluidos": 1348,
    "cobertura_pct": 96.2,
    "variacao_volume_pct": -33.2,
    "com_motivo_declarado": 1297,
    "sem_motivo_declarado": 51,
    "concluidos_periodo_anterior": 2019
  },
  "by_reason": [
    {
      "n": 729,
      "share": 54.1,
      "prev_n": 304,
      "category": "Insatisfação com o produto",
      "delta_pp": 39,
      "prev_share": 15.1,
      "order_value": 162446.8,
      "dias_mediano": 3,
      "devolvido_pct": 65.7,
      "refunded_value": 106665.34
    },
    {
      "n": 192,
      "share": 14.2,
      "prev_n": 498,
      "category": "Produto não funcionou como esperado",
      "delta_pp": -10.4,
      "prev_share": 24.7,
      "order_value": 103686.71,
      "dias_mediano": 11,
      "devolvido_pct": 86.6,
      "refunded_value": 89764.19
    },
    {
      "n": 107,
      "share": 7.9,
      "prev_n": 207,
      "category": "Compra em excesso",
      "delta_pp": -2.3,
      "prev_share": 10.3,
      "order_value": 56868.36,
      "dias_mediano": 3,
      "devolvido_pct": 72,
      "refunded_value": 40933.31
    },
    {
      "n": 104,
      "share": 7.7,
      "prev_n": 192,
      "category": "Indicação médica / efeitos colaterais",
      "delta_pp": -1.8,
      "prev_share": 9.5,
      "order_value": 68086.32,
      "dias_mediano": 2,
      "devolvido_pct": 68.1,
      "refunded_value": 46377.3
    }
  ],
  "by_channel": [
    {
      "n": 704,
      "name": "Email",
      "share": 52.2
    },
    {
      "n": 456,
      "name": "SMS",
      "share": 33.8
    },
    {
      "n": 175,
      "name": "Clickbank",
      "share": 13
    },
    {
      "n": 13,
      "name": "Não informado",
      "share": 1
    }
  ],
  "by_product": [
    {
      "n": 351,
      "share": 26,
      "product": "Steelpower",
      "top_reason": "Insatisfação com o produto",
      "order_value": 136890.19,
      "top_reason_n": 185,
      "devolvido_pct": 79.2,
      "refunded_value": 108390.25,
      "top_reason_share": 52.7
    },
    {
      "n": 317,
      "share": 23.5,
      "product": "NerveEase",
      "top_reason": "Insatisfação com o produto",
      "order_value": 95051.35,
      "top_reason_n": 170,
      "devolvido_pct": 70.5,
      "refunded_value": 67030.71,
      "top_reason_share": 53.6
    },
    {
      "n": 169,
      "share": 12.5,
      "product": "Presgera",
      "top_reason": "Insatisfação com o produto",
      "order_value": 94747.82,
      "top_reason_n": 98,
      "devolvido_pct": 76.6,
      "refunded_value": 72574.58,
      "top_reason_share": 58
    }
  ],
  "by_platform": [
    {
      "n": 522,
      "name": "Buygoods",
      "share": 38.7
    },
    {
      "n": 486,
      "name": "ClickBank",
      "share": 36.1
    },
    {
      "n": 294,
      "name": "Cartpanda",
      "share": 21.8
    },
    {
      "n": 21,
      "name": "SalesBound",
      "share": 1.6
    },
    {
      "n": 12,
      "name": "CartCandy",
      "share": 0.9
    },
    {
      "n": 7,
      "name": "LogiCall",
      "share": 0.5
    },
    {
      "n": 3,
      "name": "Digistore24",
      "share": 0.2
    },
    {
      "n": 3,
      "name": "Nenhum",
      "share": 0.2
    }
  ],
  "reason_monthly": [
    {
      "n": 237,
      "month": "2026-06",
      "share": 43.9,
      "category": "Insatisfação com o produto"
    },
    {
      "n": 91,
      "month": "2026-06",
      "share": 16.9,
      "category": "Produto não funcionou como esperado"
    },
    {
      "n": 55,
      "month": "2026-06",
      "share": 10.2,
      "category": "Compra em excesso"
    },
    {
      "n": 27,
      "month": "2026-06",
      "share": 5,
      "category": "Indicação médica / efeitos colaterais"
    },
    {
      "n": 300,
      "month": "2026-07",
      "share": 56.1,
      "category": "Insatisfação com o produto"
    },
    {
      "n": 75,
      "month": "2026-07",
      "share": 14,
      "category": "Produto não funcionou como esperado"
    },
    {
      "n": 65,
      "month": "2026-07",
      "share": 12.1,
      "category": "Indicação médica / efeitos colaterais"
    },
    {
      "n": 31,
      "month": "2026-07",
      "share": 5.8,
      "category": "Compra em excesso"
    },
    {
      "n": 192,
      "month": "2026-08",
      "share": 70.3,
      "category": "Insatisfação com o produto"
    },
    {
      "n": 26,
      "month": "2026-08",
      "share": 9.5,
      "category": "Produto não funcionou como esperado"
    },
    {
      "n": 21,
      "month": "2026-08",
      "share": 7.7,
      "category": "Compra em excesso"
    },
    {
      "n": 12,
      "month": "2026-08",
      "share": 4.4,
      "category": "Indicação médica / efeitos colaterais"
    }
  ],
  "matrix_products": [
    {
      "n": 351,
      "product": "Steelpower"
    },
    {
      "n": 317,
      "product": "NerveEase"
    },
    {
      "n": 169,
      "product": "Presgera"
    }
  ],
  "reason_by_product": [
    {
      "n": 185,
      "lift": 0.97,
      "product": "Steelpower",
      "category": "Insatisfação com o produto",
      "baseline_share": 54.1,
      "share_in_product": 52.7
    },
    {
      "n": 71,
      "lift": 1.42,
      "product": "Steelpower",
      "category": "Produto não funcionou como esperado",
      "baseline_share": 14.2,
      "share_in_product": 20.2
    },
    {
      "n": 26,
      "lift": 0.93,
      "product": "Steelpower",
      "category": "Compra em excesso",
      "baseline_share": 7.9,
      "share_in_product": 7.4
    },
    {
      "n": 18,
      "lift": 0.66,
      "product": "Steelpower",
      "category": "Indicação médica / efeitos colaterais",
      "baseline_share": 7.7,
      "share_in_product": 5.1
    },
    {
      "n": 12,
      "lift": 0.82,
      "product": "Steelpower",
      "category": "Arrependimento de compra",
      "baseline_share": 4.2,
      "share_in_product": 3.4
    },
    {
      "n": 10,
      "lift": 0.78,
      "product": "Steelpower",
      "category": "Atraso na entrega/acesso",
      "baseline_share": 3.6,
      "share_in_product": 2.8
    },
    {
      "n": 9,
      "lift": 1.65,
      "product": "Steelpower",
      "category": "Follow up (sem motivo declarado)",
      "baseline_share": 1.6,
      "share_in_product": 2.6
    },
    {
      "n": 9,
      "lift": 1.5,
      "product": "Steelpower",
      "category": "Risco de chargeback",
      "baseline_share": 1.7,
      "share_in_product": 2.6
    }
  ]
} as CopyRefundAnalytics;
