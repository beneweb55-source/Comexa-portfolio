import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UserStatus } from '../../generated/prisma/enums.js';
import { compareMembers, type MemberOrderFields } from './member-order.js';

function member(overrides: Partial<MemberOrderFields> & { status: UserStatus }): MemberOrderFields {
  return { lastName: 'Nom', firstName: 'Prenom', ...overrides };
}

describe('compareMembers — annuaire des membres', () => {
  it('place les comptes actifs avant les invites, archives puis suspendus', () => {
    const suspended = member({ status: UserStatus.SUSPENDED, lastName: 'Aaa' });
    const archived = member({ status: UserStatus.ARCHIVED, lastName: 'Bbb' });
    const invited = member({ status: UserStatus.INVITED, lastName: 'Ccc' });
    const active = member({ status: UserStatus.ACTIVE, lastName: 'Zzz' });

    const sorted = [suspended, archived, invited, active].sort(compareMembers);
    assert.deepEqual(
      sorted.map((entry) => entry.status),
      [UserStatus.ACTIVE, UserStatus.INVITED, UserStatus.ARCHIVED, UserStatus.SUSPENDED],
    );
  });

  it('met les suspendus tout en bas, meme devant un nom qui commence par A', () => {
    const activeZ = member({ status: UserStatus.ACTIVE, lastName: 'Zizi' });
    const suspendedA = member({ status: UserStatus.SUSPENDED, lastName: 'Abba' });
    const sorted = [suspendedA, activeZ].sort(compareMembers);
    assert.equal(sorted[0], activeZ);
    assert.equal(sorted[1], suspendedA);
  });

  it('range par nom puis prenom dans un meme statut, sans tenir compte de la casse', () => {
    const benaliSami = member({ status: UserStatus.ACTIVE, lastName: 'Benali', firstName: 'Sami' });
    const benaliAmina = member({ status: UserStatus.ACTIVE, lastName: 'benali', firstName: 'Amina' });
    const amrani = member({ status: UserStatus.ACTIVE, lastName: 'Amrani', firstName: 'Yacine' });

    const sorted = [benaliSami, benaliAmina, amrani].sort(compareMembers);
    assert.deepEqual(
      sorted.map((entry) => `${entry.lastName}:${entry.firstName}`),
      ['Amrani:Yacine', 'benali:Amina', 'Benali:Sami'],
    );
  });

  it('est stable pour deux membres identiques (tri reflexif, egal a zero)', () => {
    const twin = member({ status: UserStatus.ACTIVE, lastName: 'Twin', firstName: 'Sam' });
    assert.equal(compareMembers(twin, { ...twin }), 0);
  });
});
