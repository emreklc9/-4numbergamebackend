import { randomInt } from 'node:crypto';

export type Feedback = { plus: number; minus: number };

// Rakamlar birbirinden farklı, ilk rakam 0 değil.
export function generateSecret(digits: number): string {
  const pool = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  let secret = '';
  while (secret.length < digits) {
    const index = randomInt(pool.length);
    if (secret.length === 0 && pool[index] === '0') continue;
    secret += pool.splice(index, 1)[0];
  }
  return secret;
}

export function validateGuess(guess: string, digits: number): string | null {
  if (!/^\d+$/.test(guess) || guess.length !== digits) return `${digits} haneli bir sayı gir`;
  if (new Set(guess).size !== digits) return 'Rakamlar birbirinden farklı olmalı';
  return null;
}

// plus: doğru rakam doğru yer, minus: doğru rakam yanlış yer
export function evaluateGuess(secret: string, guess: string): Feedback {
  let plus = 0;
  let minus = 0;
  for (let i = 0; i < secret.length; i++) {
    if (guess[i] === secret[i]) plus++;
    else if (secret.includes(guess[i])) minus++;
  }
  return { plus, minus };
}
