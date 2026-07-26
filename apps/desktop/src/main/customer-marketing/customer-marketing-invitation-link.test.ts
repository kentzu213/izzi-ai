import { describe, expect, it } from 'vitest';
import {
  buildCustomerMarketingInvitationLink,
  parseCustomerMarketingInvitationLink,
} from './customer-marketing-invitation-link';

const VALID_TOKEN = 'AbCdEf0123456789_-xy';
const LINK_PREFIX = 'openclaw://customer-marketing/invitations/accept?token=';

describe('customer marketing invitation links', () => {
  it('builds the exact deep link and parses its token', () => {
    const link = buildCustomerMarketingInvitationLink(VALID_TOKEN);

    expect(link).toBe(`${LINK_PREFIX}${VALID_TOKEN}`);
    expect(parseCustomerMarketingInvitationLink(link)).toBe(VALID_TOKEN);
  });

  it.each([20, 256])('round trips a %i-character token', (length) => {
    const token = 'a'.repeat(length);

    expect(parseCustomerMarketingInvitationLink(
      buildCustomerMarketingInvitationLink(token),
    )).toBe(token);
  });

  it.each([
    '',
    'a'.repeat(19),
    'a'.repeat(257),
    `${'a'.repeat(20)}=`,
    `${'a'.repeat(19)} `,
  ])('refuses to build a link for an invalid token', (token) => {
    expect(() => buildCustomerMarketingInvitationLink(token)).toThrow('Invalid invitation token');
  });

  it.each([
    `https://customer-marketing/invitations/accept?token=${VALID_TOKEN}`,
    `openclaw://other/invitations/accept?token=${VALID_TOKEN}`,
    `openclaw://customer-marketing/invitations/reject?token=${VALID_TOKEN}`,
    `openclaw://customer-marketing/invitations/accept/?token=${VALID_TOKEN}`,
    `openclaw://user@customer-marketing/invitations/accept?token=${VALID_TOKEN}`,
    `openclaw://customer-marketing:443/invitations/accept?token=${VALID_TOKEN}`,
    `${LINK_PREFIX}${VALID_TOKEN}#fragment`,
  ])('rejects a link with a non-canonical URL component: %s', (link) => {
    expect(parseCustomerMarketingInvitationLink(link)).toBeNull();
  });

  it.each([
    `${LINK_PREFIX}${VALID_TOKEN}&token=${VALID_TOKEN}`,
    `${LINK_PREFIX}${VALID_TOKEN}&source=email`,
    `${LINK_PREFIX}${VALID_TOKEN}%20`,
    `${LINK_PREFIX}${VALID_TOKEN}%09`,
    `${LINK_PREFIX}${'a'.repeat(257)}`,
    `${LINK_PREFIX}${'a'.repeat(19)}`,
    `${LINK_PREFIX}${VALID_TOKEN}=`,
  ])('rejects invalid query or token input: %s', (link) => {
    expect(parseCustomerMarketingInvitationLink(link)).toBeNull();
  });
});
