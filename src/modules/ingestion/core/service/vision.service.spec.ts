import { VisionService } from './vision.service';

describe('VisionService', () => {
  const config = { get: jest.fn().mockReturnValue('test-api-key') } as any;
  const service = new VisionService(config);

  it('preserves work values returned by page-level Vision headers', () => {
    const merged = (service as any).mergePageVisionResults([
      `===HEADER_JSON_START===
{"obra":"Reabilitação da rodovia","valor_obra":"R$ 12.345.678,90","valor_atestado":null}
===HEADER_JSON_END===
===ITEMS_JSON_START===
{"itens":[]}
===ITEMS_JSON_END===`,
    ]);

    expect((service as any).parseHeaderBlock(merged)).toEqual({
      obra: 'Reabilitação da rodovia',
      valor_obra: 'R$ 12.345.678,90',
    });
  });
});
