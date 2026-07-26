const INVITATION_LINK_PREFIX = 'openclaw://customer-marketing/invitations/accept?token=';
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,256}$/;
const MAX_INVITATION_LINK_LENGTH = INVITATION_LINK_PREFIX.length + 256;

export function buildCustomerMarketingInvitationLink(token: string): string {
  if (!INVITATION_TOKEN_PATTERN.test(token)) {
    throw new TypeError('Invalid invitation token');
  }

  return `${INVITATION_LINK_PREFIX}${token}`;
}

export function parseCustomerMarketingInvitationLink(link: string): string | null {
  if (
    typeof link !== 'string'
    || link.length > MAX_INVITATION_LINK_LENGTH
    || !link.startsWith(INVITATION_LINK_PREFIX)
  ) {
    return null;
  }

  const token = link.slice(INVITATION_LINK_PREFIX.length);
  return INVITATION_TOKEN_PATTERN.test(token) ? token : null;
}
