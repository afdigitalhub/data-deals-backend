/** Twi greetings by time of day (Ghana time), each with an English line for everyone. */
export function twiGreeting(d = new Date()) {
  const h = d.getHours();
  if (h >= 4 && h < 12) return { twi: 'Maakye', en: 'Good morning' };
  if (h >= 12 && h < 16) return { twi: 'Maaha', en: 'Good afternoon' };
  return { twi: 'Maadwo', en: 'Good evening' };
}
export const TWI_LINES = [
  { twi: 'Akwaaba bio!', en: 'Welcome back!' },
  { twi: 'Wo ho te sɛn?', en: 'How are you today?' },
  { twi: 'Yɛda wo ase!', en: 'Thank you for choosing Data Glow.' },
  { twi: 'Nyame nhyira wo!', en: 'God bless you!' },
];
export const dailyTwiLine = (d = new Date()) => TWI_LINES[d.getDate() % TWI_LINES.length];
