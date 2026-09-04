/** Browser-safe surface. Keep persistence and server concerns out of this barrel. */
export * from './core/types';
export { localizeClinicalText } from './core/localization';
export { evaluateClinicalFormCondition, isClinicalFormFieldVisible } from './core/conditions';
export {
  clinicalFormVersionKey,
  compareClinicalFormVersions,
  validateClinicalFormSchema,
} from './core/schema';
export { validateClinicalFormAnswers } from './core/validation';
export { parseClinicalFormSchema } from './core/decode';
