import { describe, it, expect } from 'vitest';
import { isValidCPF, isValidCNPJ, normalizeBRMobile, suggestEmailDomain, isValidName, moderationFlags } from './validators';
import { canTransition } from './order-state';

describe('validadores', () => {
  it('CPF', () => {
    expect(isValidCPF('529.982.247-25')).toBe(true);
    expect(isValidCPF('111.111.111-11')).toBe(false);
    expect(isValidCPF('529.982.247-24')).toBe(false);
  });
  it('CNPJ', () => {
    expect(isValidCNPJ('11.222.333/0001-81')).toBe(true);
    expect(isValidCNPJ('11.222.333/0001-80')).toBe(false);
  });
  it('celular', () => {
    expect(normalizeBRMobile('(31) 99999-0000')).toBe('+5531999990000');
    expect(normalizeBRMobile('(20) 99999-0000')).toBeNull();
    expect(normalizeBRMobile('(31) 3333-0000')).toBeNull();
  });
  it('sugestão de e-mail', () => {
    expect(suggestEmailDomain('maria@gmial.com')).toBe('maria@gmail.com');
    expect(suggestEmailDomain('maria@gmail.com')).toBeNull();
  });
  it('nome completo', () => {
    expect(isValidName('Maria')).toBe(false);
    expect(isValidName('Maria Souza')).toBe(true);
  });
  it('moderação', () => {
    expect(moderationFlags('Curso FIQUE RICO em 7 dias')).toEqual(['fique rico']);
    expect(moderationFlags('Confeitaria Lucrativa')).toEqual([]);
  });
});

describe('máquina de estados (8.1)', () => {
  it('não regride de paid para pending', () => {
    expect(canTransition('paid', 'pending')).toBe(false);
    expect(canTransition('pending', 'paid')).toBe(true);
    expect(canTransition('refunded', 'paid')).toBe(false);
  });
});
