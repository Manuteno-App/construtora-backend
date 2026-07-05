import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EvaluateBundleDto } from './qualification.dto';

describe('EvaluateBundleDto', () => {
  it('accepts valid ONE/MANY/MAX payloads', async () => {
    const dto = plainToInstance(EvaluateBundleDto, {
      bundleMode: 'MAX',
      maxAtestados: 2,
      services: [
        { query: 'Pavimentacao', proofMode: 'ONE' },
        { query: 'Drenagem', proofMode: 'MAX', maxAtestados: 3, minQuantidade: 10 },
      ],
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('requires global maxAtestados when bundleMode is MAX', async () => {
    const dto = plainToInstance(EvaluateBundleDto, {
      bundleMode: 'MAX',
      services: [{ query: 'Pavimentacao' }],
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'maxAtestados')).toBe(true);
  });

  it('requires per-service maxAtestados when proofMode is MAX', async () => {
    const dto = plainToInstance(EvaluateBundleDto, {
      bundleMode: 'MANY',
      services: [{ query: 'Pavimentacao', proofMode: 'MAX' }],
    });

    const errors = await validate(dto);
    const serviceErrors = errors.find((error) => error.property === 'services');
    expect(serviceErrors?.children?.[0]?.children?.some((child) => child.property === 'maxAtestados')).toBe(true);
  });
});
