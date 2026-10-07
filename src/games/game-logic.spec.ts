import { evaluateGuess, generateSecret, validateGuess } from './game-logic';

describe('game-logic', () => {
  it.each([3, 4, 5])('%i haneli, benzersiz rakamlı ve 0 ile başlamayan sayı üretir', (digits) => {
    for (let i = 0; i < 200; i++) {
      const secret = generateSecret(digits);
      expect(secret).toHaveLength(digits);
      expect(new Set(secret).size).toBe(digits);
      expect(secret[0]).not.toBe('0');
    }
  });

  it('tahmini doğrular', () => {
    expect(validateGuess('123', 4)).not.toBeNull();
    expect(validateGuess('1123', 4)).not.toBeNull();
    expect(validateGuess('12a4', 4)).not.toBeNull();
    expect(validateGuess('1234', 4)).toBeNull();
  });

  it('artı ve eksi hesaplar', () => {
    expect(evaluateGuess('1234', '1234')).toEqual({ plus: 4, minus: 0 });
    expect(evaluateGuess('1234', '4321')).toEqual({ plus: 0, minus: 4 });
    expect(evaluateGuess('1234', '1567')).toEqual({ plus: 1, minus: 0 });
    expect(evaluateGuess('1234', '2135')).toEqual({ plus: 1, minus: 2 });
  });
});
