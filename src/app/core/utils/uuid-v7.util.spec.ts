import { generateUuidV7 } from "./uuid-v7.util";

describe('UuidV7Util', () => {

  it('should generate a valid UUIDv7 format complying with RFC 9562', () => {
    const uuid = generateUuidV7();

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuid).toMatch(uuidRegex);

    // RFC 9562 Compliance: The 13th character (index 14) MUST be '7'
    expect(uuid.charAt(14)).toBe('7');
  })

  it('should not generate colliding UUIDs on rapid sequential execution', () => {
    const totalSamples = 1000;
    const generatedKeys = new Set<string>();

    for (let i = 0; i < totalSamples; i++) {
      generatedKeys.add(generateUuidV7());
    }
    expect(generatedKeys.size).toBe(totalSamples);
  });

})
