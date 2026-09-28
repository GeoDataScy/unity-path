import { ERROR_STATUS, type ErrorCode } from "@xmx/contract";

/**
 * Erro de negócio com código estável.
 *
 * O código faz parte do contrato: o front reage a ele. A mensagem é
 * técnica e serve para log — o texto que o usuário lê é escolhido pelo
 * front, para o pt-BR ficar onde pertence.
 */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  toJSON() {
    return {
      error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) },
    };
  }
}

export const fail = (code: ErrorCode, message: string, details?: Record<string, unknown>): never => {
  throw new ApiError(code, message, details);
};
