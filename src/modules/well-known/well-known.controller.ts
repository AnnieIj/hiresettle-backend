import { Controller, Get, Header } from '@nestjs/common';

@Controller('.well-known')
export class WellKnownController {
  @Get('security.txt')
  @Header('Content-Type', 'text/plain')
  getSecurityTxt(): string {
    // Security.txt standard: https://securitytxt.org/
    // RFC 9116: https://www.rfc-editor.org/rfc/rfc9116.html
    const lines = [
      'Contact: mailto:security@hiresettle.com',
      'Expires: 2027-12-31T23:59:59.000Z',
      'Preferred-Languages: en',
      'Canonical: https://hiresettle.com/.well-known/security.txt',
      '',
      '# Our security team monitors this inbox for vulnerability reports.',
      '# Please include detailed steps to reproduce any security issues.',
      '# We aim to acknowledge reports within 48 hours.',
    ];
    return lines.join('\n');
  }
}
