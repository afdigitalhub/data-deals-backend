export const ghs = (minor: number) => `GH₵ ${(minor / 100).toLocaleString('en-GH', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const prettyPhone = (p: string) => p.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3');
export const dateTime = (iso: string) => new Date(iso).toLocaleString('en-GH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
