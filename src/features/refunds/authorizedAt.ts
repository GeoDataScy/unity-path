// refunds.authorized_at ↔ <input type="datetime-local"> (horário local do navegador).

/** Valor do campo de data/hora → ISO para gravar em refunds.authorized_at (null se vazio). */
export function authorizedAtToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO → "YYYY-MM-DDTHH:mm" no horário local, formato do <input type="datetime-local">. */
export function isoToAuthorizedAtInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
