import { randomBytes, randomInt, randomUUID } from 'crypto';

let sequence = 0;

function next(label: string): string {
  sequence += 1;
  return `${label}-${sequence}`;
}

function words(count = 3): string {
  return Array.from({ length: count }, (_, index) => `word${index + 1}`).join(
    ' ',
  );
}

/**
 * Small deterministic-shape fixture generator for unit tests. Keeping test data
 * local avoids loading a production-irrelevant templating toolchain in CI.
 */
export const faker = {
  number: {
    int: (maximum = 10_000) => randomInt(0, Math.max(1, maximum)),
  },
  person: {
    fullName: () => `Test Person ${next('name')}`,
  },
  internet: {
    username: () => next('test-user'),
    email: () => `${next('person')}@example.test`,
    url: () => `https://example.test/${next('resource')}`,
  },
  company: {
    name: () => `Test Organization ${next('organization')}`,
  },
  commerce: {
    productName: () => `Research Artifact ${next('artifact')}`,
    productDescription: () =>
      'A controlled research fixture description suitable for service validation.',
    department: () => next('research'),
  },
  lorem: {
    sentence: (count = 8) => `${words(count)}.`,
    sentences: (count = 3) =>
      Array.from({ length: count }, () => `${words(8)}.`).join(' '),
    paragraph: () => `${words(25)}.`,
    words,
  },
  string: {
    uuid: () => randomUUID(),
    alphanumeric: (length: number) =>
      randomBytes(Math.ceil(length / 2))
        .toString('hex')
        .slice(0, length),
    hexadecimal: ({
      length,
      prefix = '0x',
    }: {
      length: number;
      prefix?: string;
    }) =>
      `${prefix}${randomBytes(Math.ceil(length / 2))
        .toString('hex')
        .slice(0, length)}`,
  },
  system: {
    fileName: () => `${next('fixture')}.txt`,
  },
};
