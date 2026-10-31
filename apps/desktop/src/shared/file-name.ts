const pad = (value: number): string => String(value).padStart(2, '0');

/** `YYYYMMDD_HHmmss_pgsketch.sql`, in the time of the person saving it. */
export function migrationFileName(at: Date): string {
  const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
  return `${date}_${time}_pgsketch.sql`;
}
