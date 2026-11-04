/**
 * Drug Interaction Checking Service
 *
 * Provides clinical decision support by checking for known dangerous
 * drug-drug interactions. Focused on medications commonly used in
 * South Sudanese hospitals.
 *
 * Interaction severity levels:
 * - CONTRAINDICATED: Must not be co-administered
 * - SERIOUS: May cause significant harm; consider alternatives
 * - MODERATE: Monitor closely; adjust dose if needed
 *
 * Based on WHO Essential Medicines interactions and BNF/BNFC guidelines.
 */
import { isNoAllergySentinel } from '../clinical-roles';

export type InteractionSeverity = 'contraindicated' | 'serious' | 'moderate';

export interface DrugInteraction {
  drug1: string;
  drug2: string;
  severity: InteractionSeverity;
  /**
   * Where the rule comes from. US prescribing labels are the standard: a pair
   * a label lists under Contraindications is `contraindicated`, one it says to
   * avoid or not recommend is `serious`, one it says to monitor is `moderate`.
   * `other` marks a rule no US label states, kept from WHO and national
   * guidance because the medicine has no US label or the label is silent.
   */
  source: 'us-label' | 'other';
  description: string;
  clinicalAdvice: string;
}

export interface InteractionCheckResult {
  hasInteractions: boolean;
  interactions: DrugInteraction[];
  highestSeverity: InteractionSeverity | null;
}

// Normalized drug name lookup (lowercase, trimmed)
function normalize(name: string): string {
  return name.toLowerCase().trim();
}

// The formulary and the rules below must spell a drug the same way or a rule
// never fires, so other names for it are folded into the rule's spelling here.
// Interactions only: allergy matching compares what was recorded, as recorded.
// Eye, ear and skin preparations reach the blood in amounts too small for the
// systemic interactions below, which the US labels describe for tablets and
// injections. Without this, ciprofloxacin eye drops raised a QT warning.
const LOCAL_PREPARATION = /\b(eye|ear)\b|\bdrops\b|ointment|\bcream\b|topical|pessary|mouthwash|lotion|\(skin\)|cord care/i;

function interactionName(name: string): string {
  if (LOCAL_PREPARATION.test(name)) return '';
  return normalize(name)
    .replace(/\bphenobarbitone\b/g, 'phenobarbital')
    .replace(/\biron\b/g, 'ferrous')
    .replace(/\bsulphate\b/g, 'sulfate')
    .replace(/\b(co-trimoxazole|septrin|bactrim|sulfamethoxazole[-/ +]+trimethoprim|trimethoprim[-/ +]+sulfamethoxazole)\b/g, 'cotrimoxazole')
    .replace(/\b(coartem|artemether[-/ +]+lumefantrine)\b/g, 'artemether-lumefantrine')
    .replace(/\b(co-amoxiclav|augmentin)\b/g, 'amoxicillin');
}

// Known drug interactions database
// This covers the most clinically significant interactions for medications
// commonly available in South Sudanese hospital pharmacies.
const INTERACTION_DATABASE: DrugInteraction[] = [
  {
    drug1: 'warfarin',
    drug2: 'cotrimoxazole',
    severity: 'serious',
    source: 'us-label',
    description: 'Cotrimoxazole markedly raises warfarin levels, risking haemorrhage.',
    clinicalAdvice: 'Avoid if possible. If essential, reduce the warfarin dose and check INR within 3 days.',
  },
  {
    drug1: 'warfarin',
    drug2: 'ciprofloxacin',
    severity: 'serious',
    source: 'us-label',
    description: 'Ciprofloxacin can raise warfarin levels and INR.',
    clinicalAdvice: 'Check INR within 3 days of starting and after stopping.',
  },
  {
    drug1: 'warfarin',
    drug2: 'fluconazole',
    severity: 'serious',
    source: 'us-label',
    description: 'Fluconazole inhibits warfarin metabolism, raising INR.',
    clinicalAdvice: 'Check INR within 3 days and reduce the warfarin dose if needed.',
  },
  {
    drug1: 'warfarin',
    drug2: 'rifampicin',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifampicin strongly reduces warfarin levels, risking clots.',
    clinicalAdvice: 'Monitor INR closely and adjust the dose during and after treatment.',
  },
  {
    drug1: 'warfarin',
    drug2: 'aspirin',
    severity: 'serious',
    source: 'us-label',
    description: 'Combined antiplatelet and anticoagulant effect raises bleeding risk.',
    clinicalAdvice: 'Give together only with a clear indication, and monitor for bleeding.',
  },
  {
    drug1: 'warfarin',
    drug2: 'ibuprofen',
    severity: 'serious',
    source: 'us-label',
    description: 'NSAIDs raise bleeding risk with warfarin, especially from the stomach.',
    clinicalAdvice: 'Avoid. Paracetamol is the safer analgesic.',
  },
  {
    drug1: 'warfarin',
    drug2: 'diclofenac',
    severity: 'serious',
    source: 'us-label',
    description: 'NSAIDs raise bleeding risk with warfarin, especially from the stomach.',
    clinicalAdvice: 'Avoid. Paracetamol is the safer analgesic.',
  },
  {
    drug1: 'methotrexate',
    drug2: 'ibuprofen',
    severity: 'serious',
    source: 'us-label',
    description: 'NSAIDs reduce methotrexate clearance, risking toxicity.',
    clinicalAdvice: 'Avoid with high doses. With low weekly doses, monitor blood count and renal function.',
  },
  {
    drug1: 'methotrexate',
    drug2: 'diclofenac',
    severity: 'serious',
    source: 'us-label',
    description: 'NSAIDs reduce methotrexate clearance, risking toxicity.',
    clinicalAdvice: 'Avoid with high doses. With low weekly doses, monitor blood count and renal function.',
  },
  {
    drug1: 'methotrexate',
    drug2: 'aspirin',
    severity: 'serious',
    source: 'us-label',
    description: 'Aspirin reduces methotrexate clearance, risking toxicity.',
    clinicalAdvice: 'Avoid with high doses. With low weekly doses, monitor blood count and renal function.',
  },
  // === CONTRAINDICATED ===
  {
    drug1: 'methotrexate',
    drug2: 'cotrimoxazole',
    severity: 'serious',
    source: 'us-label',
    description: 'Cotrimoxazole increases methotrexate toxicity by reducing renal clearance.',
    clinicalAdvice: 'Do NOT co-prescribe. Use alternative antibiotic.',
  },
  {
    drug1: 'warfarin',
    drug2: 'metronidazole',
    severity: 'serious',
    source: 'us-label',
    description: 'Metronidazole significantly increases warfarin anticoagulant effect, risking haemorrhage.',
    clinicalAdvice: 'Avoid combination. If essential, reduce warfarin dose by 30-50% and monitor INR daily.',
  },
  {
    drug1: 'artemether-lumefantrine',
    drug2: 'quinine',
    severity: 'serious',
    source: 'us-label',
    description: 'Both prolong QT interval; combined use risks fatal cardiac arrhythmia.',
    clinicalAdvice: 'Never co-administer. Wait at least 12 hours after quinine before starting AL.',
  },
  {
    drug1: 'ciprofloxacin',
    drug2: 'tizanidine',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Ciprofloxacin inhibits CYP1A2, dramatically increasing tizanidine levels.',
    clinicalAdvice: 'Do NOT co-prescribe. Use alternative muscle relaxant.',
  },

  // === SERIOUS ===
  {
    drug1: 'gentamicin',
    drug2: 'furosemide',
    severity: 'serious',
    source: 'us-label',
    description: 'Combined ototoxicity and nephrotoxicity. Hearing loss may be irreversible.',
    clinicalAdvice: 'Monitor renal function and hearing. Avoid if possible; if essential, use lowest effective doses.',
  },
  {
    drug1: 'morphine',
    drug2: 'diazepam',
    severity: 'serious',
    source: 'us-label',
    description: 'Combined respiratory depression; risk of respiratory arrest especially in malnourished patients.',
    clinicalAdvice: 'Use with extreme caution. Reduce doses. Have naloxone and flumazenil available.',
  },
  {
    drug1: 'amlodipine',
    drug2: 'simvastatin',
    severity: 'serious',
    source: 'us-label',
    description: 'Amlodipine increases simvastatin levels, increasing risk of rhabdomyolysis.',
    clinicalAdvice: 'Limit simvastatin to 20mg daily when co-prescribed with amlodipine.',
  },
  {
    drug1: 'metformin',
    drug2: 'contrast dye',
    severity: 'serious',
    source: 'us-label',
    description: 'Risk of lactic acidosis with iodinated contrast media.',
    clinicalAdvice: 'Withhold metformin 48h before and after contrast administration. Check renal function.',
  },
  {
    drug1: 'insulin',
    drug2: 'ciprofloxacin',
    severity: 'serious',
    source: 'us-label',
    description: 'Fluoroquinolones can cause both hypo- and hyperglycaemia.',
    clinicalAdvice: 'Monitor blood glucose closely. Adjust insulin doses as needed.',
  },
  {
    drug1: 'isoniazid',
    drug2: 'rifampicin',
    severity: 'serious',
    source: 'us-label',
    description: 'Both are hepatotoxic. Combined use increases risk of drug-induced liver injury.',
    clinicalAdvice: 'Standard TB treatment — monitor LFTs baseline and monthly. Stop if ALT >5x ULN.',
  },
  {
    drug1: 'phenobarbital',
    drug2: 'artemether-lumefantrine',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Phenobarbitone induces CYP3A4, reducing lumefantrine levels and antimalarial efficacy.',
    clinicalAdvice: 'Consider artesunate monotherapy or quinine for epileptic patients on phenobarbitone.',
  },
  {
    drug1: 'magnesium sulfate',
    drug2: 'gentamicin',
    severity: 'serious',
    source: 'other',
    description: 'Additive neuromuscular blockade; risk of respiratory paralysis. No US label states this; it comes from WHO and national guidance.',
    clinicalAdvice: 'Avoid if possible. If co-administration required, monitor closely for respiratory depression.',
  },

  // === MODERATE ===
  {
    drug1: 'amoxicillin',
    drug2: 'warfarin',
    severity: 'moderate',
    source: 'us-label',
    description: 'Amoxicillin may enhance anticoagulant effect of warfarin.',
    clinicalAdvice: 'Monitor INR more frequently during antibiotic course.',
  },
  {
    drug1: 'ibuprofen',
    drug2: 'enalapril',
    severity: 'moderate',
    source: 'us-label',
    description: 'NSAIDs reduce antihypertensive effect and increase nephrotoxicity risk.',
    clinicalAdvice: 'Use paracetamol as alternative analgesic. If NSAID needed, monitor BP and renal function.',
  },
  {
    drug1: 'ciprofloxacin',
    drug2: 'ferrous',
    severity: 'moderate',
    source: 'us-label',
    description: 'Iron chelates ciprofloxacin, reducing its absorption and efficacy.',
    clinicalAdvice: 'Give ciprofloxacin 2 hours before or 6 hours after iron supplements.',
  },
  {
    drug1: 'doxycycline',
    drug2: 'ferrous',
    severity: 'moderate',
    source: 'us-label',
    description: 'Iron reduces doxycycline absorption.',
    clinicalAdvice: 'Separate doses by at least 2-3 hours.',
  },
  {
    drug1: 'metformin',
    drug2: 'enalapril',
    severity: 'moderate',
    source: 'other',
    description: 'ACE inhibitors may increase risk of hypoglycaemia. No US label states this; it comes from WHO and national guidance.',
    clinicalAdvice: 'Monitor blood glucose, especially when starting or adjusting ACE inhibitor.',
  },
  {
    drug1: 'diclofenac',
    drug2: 'ciprofloxacin',
    severity: 'moderate',
    source: 'us-label',
    description: 'Increased risk of seizures with NSAID + fluoroquinolone combination.',
    clinicalAdvice: 'Use paracetamol instead if possible. Avoid in patients with seizure history.',
  },
  {
    drug1: 'oral rehydration salts',
    drug2: 'ciprofloxacin',
    severity: 'moderate',
    source: 'us-label',
    description: 'Minerals in ORS can chelate ciprofloxacin, reducing absorption.',
    clinicalAdvice: 'Give ciprofloxacin 2h before ORS or 2h after.',
  },

  // === FORMULARY EXPANSION (2026-11) ===
  {
    drug1: 'warfarin',
    drug2: 'heparin',
    severity: 'serious',
    source: 'us-label',
    description: 'Two anticoagulants together greatly raise the risk of major bleeding.',
    clinicalAdvice: 'Only as a planned overlap when starting warfarin. Monitor INR and watch for bleeding.',
  },
  {
    drug1: 'warfarin',
    drug2: 'enoxaparin',
    severity: 'serious',
    source: 'us-label',
    description: 'Two anticoagulants together greatly raise the risk of major bleeding.',
    clinicalAdvice: 'Only as a planned overlap when starting warfarin. Monitor INR and watch for bleeding.',
  },
  {
    drug1: 'warfarin',
    drug2: 'clopidogrel',
    severity: 'serious',
    source: 'us-label',
    description: 'Anticoagulant plus antiplatelet raises the risk of major bleeding.',
    clinicalAdvice: 'Avoid unless a clear indication exists. Monitor INR closely.',
  },
  {
    drug1: 'warfarin',
    drug2: 'amiodarone',
    severity: 'serious',
    source: 'us-label',
    description: 'Amiodarone inhibits warfarin metabolism and the effect lasts for months.',
    clinicalAdvice: 'Reduce the warfarin dose and check INR often.',
  },
  {
    drug1: 'heparin',
    drug2: 'aspirin',
    severity: 'serious',
    source: 'us-label',
    description: 'Anticoagulant plus antiplatelet raises the risk of bleeding.',
    clinicalAdvice: 'Use only with a clear indication and watch for bleeding.',
  },
  {
    drug1: 'enoxaparin',
    drug2: 'aspirin',
    severity: 'serious',
    source: 'us-label',
    description: 'Anticoagulant plus antiplatelet raises the risk of bleeding.',
    clinicalAdvice: 'Use only with a clear indication and watch for bleeding.',
  },
  {
    drug1: 'heparin',
    drug2: 'ibuprofen',
    severity: 'serious',
    source: 'us-label',
    description: 'An NSAID adds gastric and platelet bleeding risk to anticoagulation.',
    clinicalAdvice: 'Avoid. Use paracetamol for pain.',
  },
  {
    drug1: 'enoxaparin',
    drug2: 'diclofenac',
    severity: 'serious',
    source: 'us-label',
    description: 'An NSAID adds gastric and platelet bleeding risk to anticoagulation.',
    clinicalAdvice: 'Avoid. Use paracetamol for pain.',
  },
  {
    drug1: 'clopidogrel',
    drug2: 'omeprazole',
    severity: 'serious',
    source: 'us-label',
    description: 'Omeprazole reduces activation of clopidogrel, weakening its effect.',
    clinicalAdvice: 'Consider ranitidine or an alternative if acid suppression is needed.',
  },
  {
    drug1: 'lithium',
    drug2: 'ibuprofen',
    severity: 'serious',
    source: 'us-label',
    description: 'NSAIDs reduce lithium clearance and can cause lithium toxicity.',
    clinicalAdvice: 'Avoid. If essential, reduce the lithium dose and check levels.',
  },
  {
    drug1: 'lithium',
    drug2: 'diclofenac',
    severity: 'serious',
    source: 'us-label',
    description: 'NSAIDs reduce lithium clearance and can cause lithium toxicity.',
    clinicalAdvice: 'Avoid. If essential, reduce the lithium dose and check levels.',
  },
  {
    drug1: 'lithium',
    drug2: 'hydrochlorothiazide',
    severity: 'serious',
    source: 'us-label',
    description: 'Thiazides raise lithium levels and can cause toxicity.',
    clinicalAdvice: 'Avoid, or reduce the lithium dose and check levels within a week.',
  },
  {
    drug1: 'lithium',
    drug2: 'enalapril',
    severity: 'serious',
    source: 'us-label',
    description: 'ACE inhibitors raise lithium levels and can cause toxicity.',
    clinicalAdvice: 'Monitor lithium levels closely.',
  },
  {
    drug1: 'lithium',
    drug2: 'lisinopril',
    severity: 'serious',
    source: 'us-label',
    description: 'ACE inhibitors raise lithium levels and can cause toxicity.',
    clinicalAdvice: 'Monitor lithium levels closely.',
  },
  {
    drug1: 'lithium',
    drug2: 'captopril',
    severity: 'serious',
    source: 'us-label',
    description: 'ACE inhibitors raise lithium levels and can cause toxicity.',
    clinicalAdvice: 'Monitor lithium levels closely.',
  },
  {
    drug1: 'amiodarone',
    drug2: 'digoxin',
    severity: 'serious',
    source: 'us-label',
    description: 'Amiodarone raises digoxin levels, risking toxicity.',
    clinicalAdvice: 'Halve the digoxin dose and monitor levels.',
  },
  {
    drug1: 'amiodarone',
    drug2: 'haloperidol',
    severity: 'serious',
    source: 'us-label',
    description: 'Both prolong the QT interval, risking dangerous arrhythmia.',
    clinicalAdvice: 'Avoid together where possible. Check an ECG.',
  },
  {
    drug1: 'spironolactone',
    drug2: 'enalapril',
    severity: 'serious',
    source: 'us-label',
    description: 'Combined risk of dangerous hyperkalaemia.',
    clinicalAdvice: 'Check potassium and renal function within a week, then regularly.',
  },
  {
    drug1: 'spironolactone',
    drug2: 'lisinopril',
    severity: 'serious',
    source: 'us-label',
    description: 'Combined risk of dangerous hyperkalaemia.',
    clinicalAdvice: 'Check potassium and renal function within a week, then regularly.',
  },
  {
    drug1: 'spironolactone',
    drug2: 'captopril',
    severity: 'serious',
    source: 'us-label',
    description: 'Combined risk of dangerous hyperkalaemia.',
    clinicalAdvice: 'Check potassium and renal function within a week, then regularly.',
  },
  {
    drug1: 'spironolactone',
    drug2: 'losartan',
    severity: 'serious',
    source: 'us-label',
    description: 'Combined risk of dangerous hyperkalaemia.',
    clinicalAdvice: 'Check potassium and renal function within a week, then regularly.',
  },
  {
    drug1: 'spironolactone',
    drug2: 'potassium chloride',
    severity: 'serious',
    source: 'us-label',
    description: 'Potassium supplements with a potassium-sparing diuretic can cause fatal hyperkalaemia.',
    clinicalAdvice: 'Avoid unless potassium is low and being monitored.',
  },
  {
    drug1: 'enalapril',
    drug2: 'potassium chloride',
    severity: 'serious',
    source: 'us-label',
    description: 'ACE inhibitors reduce potassium excretion, risking hyperkalaemia.',
    clinicalAdvice: 'Monitor potassium closely.',
  },
  {
    drug1: 'rifampicin',
    drug2: 'lopinavir',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Rifampicin removes most of the protease inhibitor, causing treatment failure.',
    clinicalAdvice: 'Do not co-prescribe. Use a regimen compatible with TB treatment.',
  },
  {
    drug1: 'rifampicin',
    drug2: 'atazanavir',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Rifampicin removes most of the protease inhibitor, causing treatment failure.',
    clinicalAdvice: 'Do not co-prescribe. Use a regimen compatible with TB treatment.',
  },
  {
    drug1: 'rifampicin',
    drug2: 'darunavir',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Rifampicin removes most of the protease inhibitor, causing treatment failure.',
    clinicalAdvice: 'Do not co-prescribe. Use a regimen compatible with TB treatment.',
  },
  {
    drug1: 'rifampicin',
    drug2: 'nevirapine',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifampicin lowers nevirapine levels, risking treatment failure.',
    clinicalAdvice: 'Avoid. Prefer dolutegravir with dose adjustment.',
  },
  {
    drug1: 'rifampicin',
    drug2: 'dolutegravir',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifampicin halves dolutegravir exposure.',
    clinicalAdvice: 'Give dolutegravir 50 mg twice daily during TB treatment and for two weeks after.',
  },
  {
    drug1: 'rifampicin',
    drug2: 'bedaquiline',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifampicin sharply lowers bedaquiline levels.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'rifampicin',
    drug2: 'ethinylestradiol',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifampicin makes hormonal contraception unreliable.',
    clinicalAdvice: 'Use a copper IUD or DMPA, and condoms.',
  },
  {
    drug1: 'rifampicin',
    drug2: 'levonorgestrel',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifampicin makes hormonal contraception unreliable.',
    clinicalAdvice: 'Use a copper IUD or DMPA, and condoms.',
  },
  {
    drug1: 'carbamazepine',
    drug2: 'dolutegravir',
    severity: 'serious',
    source: 'us-label',
    description: 'Carbamazepine lowers dolutegravir exposure.',
    clinicalAdvice: 'Give dolutegravir 50 mg twice daily, or choose another antiepileptic.',
  },
  {
    drug1: 'carbamazepine',
    drug2: 'clozapine',
    severity: 'serious',
    source: 'us-label',
    description: 'Both can suppress the bone marrow, risking fatal agranulocytosis.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'carbamazepine',
    drug2: 'ethinylestradiol',
    severity: 'serious',
    source: 'us-label',
    description: 'Carbamazepine makes hormonal contraception unreliable.',
    clinicalAdvice: 'Use a copper IUD or DMPA, and condoms.',
  },
  {
    drug1: 'phenytoin',
    drug2: 'ethinylestradiol',
    severity: 'serious',
    source: 'us-label',
    description: 'Phenytoin makes hormonal contraception unreliable.',
    clinicalAdvice: 'Use a copper IUD or DMPA, and condoms.',
  },
  {
    drug1: 'fluoxetine',
    drug2: 'tramadol',
    severity: 'serious',
    source: 'us-label',
    description: 'Risk of serotonin syndrome and seizures, and fluoxetine weakens tramadol pain relief.',
    clinicalAdvice: 'Avoid. Choose another analgesic.',
  },
  {
    drug1: 'sertraline',
    drug2: 'tramadol',
    severity: 'serious',
    source: 'us-label',
    description: 'Risk of serotonin syndrome and seizures.',
    clinicalAdvice: 'Avoid where possible, and watch for agitation, tremor and fever.',
  },
  {
    drug1: 'fentanyl',
    drug2: 'midazolam',
    severity: 'serious',
    source: 'us-label',
    description: 'Opioid plus sedative can cause profound respiratory depression.',
    clinicalAdvice: 'Reduce both doses and monitor breathing and oxygen saturation.',
  },
  {
    drug1: 'morphine',
    drug2: 'midazolam',
    severity: 'serious',
    source: 'us-label',
    description: 'Opioid plus sedative can cause profound respiratory depression.',
    clinicalAdvice: 'Reduce both doses and monitor breathing and oxygen saturation.',
  },
  {
    drug1: 'methadone',
    drug2: 'diazepam',
    severity: 'serious',
    source: 'us-label',
    description: 'Opioid plus sedative can cause fatal respiratory depression.',
    clinicalAdvice: 'Avoid unless essential, and use the lowest doses.',
  },
  {
    drug1: 'pethidine',
    drug2: 'diazepam',
    severity: 'serious',
    source: 'us-label',
    description: 'Opioid plus sedative can cause profound respiratory depression.',
    clinicalAdvice: 'Reduce both doses and monitor breathing.',
  },
  {
    drug1: 'allopurinol',
    drug2: 'azathioprine',
    severity: 'serious',
    source: 'us-label',
    description: 'Allopurinol blocks azathioprine breakdown, causing severe bone marrow suppression.',
    clinicalAdvice: 'Reduce azathioprine to a quarter of the dose and monitor blood counts.',
  },
  {
    drug1: 'allopurinol',
    drug2: 'mercaptopurine',
    severity: 'serious',
    source: 'us-label',
    description: 'Allopurinol blocks mercaptopurine breakdown, causing severe bone marrow suppression.',
    clinicalAdvice: 'Reduce mercaptopurine to a quarter of the dose and monitor blood counts.',
  },
  {
    drug1: 'mefloquine',
    drug2: 'quinine',
    severity: 'serious',
    source: 'us-label',
    description: 'Both prolong the QT interval and lower the seizure threshold.',
    clinicalAdvice: 'Avoid together. Delay mefloquine until 12 hours after the last quinine dose.',
  },
  {
    drug1: 'amphotericin',
    drug2: 'gentamicin',
    severity: 'serious',
    source: 'us-label',
    description: 'Combined kidney toxicity.',
    clinicalAdvice: 'Avoid if possible. Monitor renal function and electrolytes daily.',
  },
  {
    drug1: 'amphotericin',
    drug2: 'amikacin',
    severity: 'serious',
    source: 'us-label',
    description: 'Combined kidney toxicity.',
    clinicalAdvice: 'Avoid if possible. Monitor renal function and electrolytes daily.',
  },
  {
    drug1: 'amphotericin',
    drug2: 'digoxin',
    severity: 'serious',
    source: 'us-label',
    description: 'Amphotericin lowers potassium, which makes digoxin toxicity more likely.',
    clinicalAdvice: 'Monitor potassium and correct it before and during treatment.',
  },
  {
    drug1: 'vancomycin',
    drug2: 'gentamicin',
    severity: 'serious',
    source: 'us-label',
    description: 'Combined kidney and hearing toxicity.',
    clinicalAdvice: 'Monitor levels and renal function.',
  },
  {
    drug1: 'propranolol',
    drug2: 'salbutamol',
    severity: 'serious',
    source: 'us-label',
    description: 'A non-selective beta-blocker blocks salbutamol and can trigger severe bronchospasm.',
    clinicalAdvice: 'Avoid propranolol in asthma. Use a cardioselective alternative.',
  },
  {
    drug1: 'propranolol',
    drug2: 'insulin',
    severity: 'moderate',
    source: 'us-label',
    description: 'Propranolol can hide the warning signs of low blood sugar.',
    clinicalAdvice: 'Warn the patient and monitor glucose.',
  },
  {
    drug1: 'ritonavir',
    drug2: 'ergotamine',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Ritonavir raises ergot levels, risking ergotism and tissue ischaemia.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'ritonavir',
    drug2: 'ergometrine',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Ritonavir raises ergot levels, risking severe vasoconstriction.',
    clinicalAdvice: 'Prefer oxytocin or misoprostol. Use only if no alternative exists.',
  },
  {
    drug1: 'erythromycin',
    drug2: 'ergotamine',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Erythromycin raises ergot levels, risking ergotism.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'haloperidol',
    drug2: 'levodopa',
    severity: 'serious',
    source: 'us-label',
    description: 'Haloperidol blocks levodopa and worsens Parkinson disease.',
    clinicalAdvice: 'Avoid. Seek specialist advice on an alternative.',
  },
  {
    drug1: 'metoclopramide',
    drug2: 'levodopa',
    severity: 'serious',
    source: 'us-label',
    description: 'Metoclopramide blocks levodopa and worsens Parkinson disease.',
    clinicalAdvice: 'Avoid. Use another antiemetic.',
  },
  {
    drug1: 'metformin',
    drug2: 'iohexol',
    severity: 'serious',
    source: 'us-label',
    description: 'Iodinated contrast can cause kidney injury and metformin lactic acidosis.',
    clinicalAdvice: 'Hold metformin at the time of contrast and for 48 hours after. Restart once renal function is stable.',
  },
  {
    drug1: 'metformin',
    drug2: 'amidotrizoate',
    severity: 'serious',
    source: 'us-label',
    description: 'Iodinated contrast can cause kidney injury and metformin lactic acidosis.',
    clinicalAdvice: 'Hold metformin at the time of contrast and for 48 hours after. Restart once renal function is stable.',
  },

  // === FROM US PRESCRIBING LABELS (openFDA / DailyMed, read 2026-11-03) ===
  {
    drug1: 'allopurinol',
    drug2: 'capecitabine',
    severity: 'serious',
    source: 'us-label',
    description: 'Allopurinol may reduce the effect of capecitabine.',
    clinicalAdvice: 'Avoid allopurinol during capecitabine treatment.',
  },
  {
    drug1: 'amikacin',
    drug2: 'furosemide',
    severity: 'serious',
    source: 'us-label',
    description: 'Combined ototoxicity and nephrotoxicity.',
    clinicalAdvice: 'Avoid together. If essential, monitor renal function and hearing.',
  },
  {
    drug1: 'amikacin',
    drug2: 'mannitol',
    severity: 'serious',
    source: 'us-label',
    description: 'Combined nephrotoxicity and ototoxicity.',
    clinicalAdvice: 'Avoid together. If essential, monitor renal function.',
  },
  {
    drug1: 'aminophylline',
    drug2: 'ketamine',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Together they lower the seizure threshold.',
    clinicalAdvice: 'Do not co-administer.',
  },
  {
    drug1: 'amiodarone',
    drug2: 'ciprofloxacin',
    severity: 'serious',
    source: 'us-label',
    description: 'Both prolong the QT interval.',
    clinicalAdvice: 'Avoid together. If essential, check an ECG.',
  },
  {
    drug1: 'amiodarone',
    drug2: 'moxifloxacin',
    severity: 'serious',
    source: 'us-label',
    description: 'Both prolong the QT interval.',
    clinicalAdvice: 'Avoid together. If essential, check an ECG.',
  },
  {
    drug1: 'amiodarone',
    drug2: 'quinine',
    severity: 'serious',
    source: 'us-label',
    description: 'Both prolong the QT interval.',
    clinicalAdvice: 'Avoid together. If essential, check an ECG.',
  },
  {
    drug1: 'amiodarone',
    drug2: 'ritonavir',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Ritonavir raises amiodarone levels, risking life-threatening arrhythmia.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'amiodarone',
    drug2: 'sofosbuvir',
    severity: 'serious',
    source: 'us-label',
    description: 'Symptomatic, sometimes fatal, bradycardia has occurred with this combination.',
    clinicalAdvice: 'Not recommended. If no alternative, monitor heart rate in hospital for the first 48 hours.',
  },
  {
    drug1: 'anastrozole',
    drug2: 'tamoxifen',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Tamoxifen lowers anastrozole levels and the combination gives no added benefit.',
    clinicalAdvice: 'Do not use together.',
  },
  {
    drug1: 'artemether-lumefantrine',
    drug2: 'carbamazepine',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Strong CYP3A4 inducers lower artemether and lumefantrine levels, risking treatment failure.',
    clinicalAdvice: 'Do not co-prescribe. Choose another antimalarial.',
  },
  {
    drug1: 'artemether-lumefantrine',
    drug2: 'phenytoin',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Strong CYP3A4 inducers lower artemether and lumefantrine levels, risking treatment failure.',
    clinicalAdvice: 'Do not co-prescribe. Choose another antimalarial.',
  },
  {
    drug1: 'artemether-lumefantrine',
    drug2: 'rifampicin',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Strong CYP3A4 inducers lower artemether and lumefantrine levels, risking treatment failure.',
    clinicalAdvice: 'Do not co-prescribe. Choose another antimalarial.',
  },
  {
    drug1: 'aspirin',
    drug2: 'diclofenac',
    severity: 'serious',
    source: 'us-label',
    description: 'Two NSAIDs together raise the risk of gastrointestinal bleeding.',
    clinicalAdvice: 'Not generally recommended. Use one anti-inflammatory.',
  },
  {
    drug1: 'aspirin',
    drug2: 'fluoxetine',
    severity: 'moderate',
    source: 'us-label',
    description: 'SSRIs with aspirin raise the risk of bleeding.',
    clinicalAdvice: 'Watch for bleeding, especially gastrointestinal.',
  },
  {
    drug1: 'atazanavir',
    drug2: 'carbamazepine',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Carbamazepine lowers atazanavir levels, risking loss of HIV control.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'atazanavir',
    drug2: 'phenobarbital',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Phenobarbital lowers atazanavir levels, risking loss of HIV control.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'atazanavir',
    drug2: 'phenytoin',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Phenytoin lowers atazanavir levels, risking loss of HIV control.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'atazanavir',
    drug2: 'irinotecan',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Atazanavir blocks irinotecan clearance, raising its toxicity.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'atazanavir',
    drug2: 'nevirapine',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Nevirapine substantially lowers atazanavir levels and atazanavir raises nevirapine toxicity.',
    clinicalAdvice: 'Do not co-administer.',
  },
  {
    drug1: 'atazanavir',
    drug2: 'efavirenz',
    severity: 'serious',
    source: 'us-label',
    description: 'Efavirenz lowers atazanavir levels.',
    clinicalAdvice: 'Not recommended in treatment-experienced patients.',
  },
  {
    drug1: 'atazanavir',
    drug2: 'omeprazole',
    severity: 'serious',
    source: 'us-label',
    description: 'Omeprazole sharply lowers atazanavir absorption.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'ritonavir',
    drug2: 'clopidogrel',
    severity: 'serious',
    source: 'us-label',
    description: 'Boosted protease inhibitors reduce clopidogrel activation, weakening its effect.',
    clinicalAdvice: 'Not recommended. Consider an alternative antiplatelet.',
  },
  {
    drug1: 'ritonavir',
    drug2: 'colchicine',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Ritonavir raises colchicine to toxic levels, especially with kidney or liver impairment.',
    clinicalAdvice: 'Do not co-prescribe in renal or hepatic impairment; otherwise reduce the colchicine dose.',
  },
  {
    drug1: 'itraconazole',
    drug2: 'colchicine',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Itraconazole raises colchicine to toxic levels.',
    clinicalAdvice: 'Do not co-prescribe in renal or hepatic impairment.',
  },
  {
    drug1: 'ritonavir',
    drug2: 'atorvastatin',
    severity: 'serious',
    source: 'us-label',
    description: 'Ritonavir raises atorvastatin levels, risking myopathy.',
    clinicalAdvice: 'Use the lowest atorvastatin dose and watch for muscle pain.',
  },
  {
    drug1: 'ritonavir',
    drug2: 'midazolam',
    severity: 'serious',
    source: 'us-label',
    description: 'Ritonavir raises midazolam levels, risking prolonged sedation. Oral midazolam is contraindicated.',
    clinicalAdvice: 'Give parenteral midazolam only with monitoring and a lower dose.',
  },
  {
    drug1: 'ritonavir',
    drug2: 'simeprevir',
    severity: 'serious',
    source: 'us-label',
    description: 'Ritonavir greatly raises simeprevir levels.',
    clinicalAdvice: 'Not recommended.',
  },
  {
    drug1: 'ritonavir',
    drug2: 'vincristine',
    severity: 'serious',
    source: 'us-label',
    description: 'Ritonavir raises vincristine levels, risking severe toxicity.',
    clinicalAdvice: 'Consider pausing ritonavir during treatment, or monitor closely.',
  },
  {
    drug1: 'ritonavir',
    drug2: 'vinblastine',
    severity: 'serious',
    source: 'us-label',
    description: 'Ritonavir raises vinblastine levels, risking severe toxicity.',
    clinicalAdvice: 'Consider pausing ritonavir during treatment, or monitor closely.',
  },
  {
    drug1: 'ritonavir',
    drug2: 'pethidine',
    severity: 'serious',
    source: 'us-label',
    description: 'Ritonavir raises norpethidine, a toxic metabolite, risking seizures.',
    clinicalAdvice: 'Avoid dose increases and long-term use together.',
  },
  {
    drug1: 'darunavir',
    drug2: 'irinotecan',
    severity: 'serious',
    source: 'us-label',
    description: 'Darunavir with ritonavir raises irinotecan toxicity.',
    clinicalAdvice: 'Do not use together unless there is no alternative.',
  },
  {
    drug1: 'darunavir',
    drug2: 'lopinavir',
    severity: 'serious',
    source: 'us-label',
    description: 'Lopinavir lowers darunavir levels.',
    clinicalAdvice: 'Not recommended.',
  },
  {
    drug1: 'ciclosporin',
    drug2: 'atorvastatin',
    severity: 'serious',
    source: 'us-label',
    description: 'Ciclosporin raises atorvastatin levels, risking myopathy.',
    clinicalAdvice: 'Not recommended.',
  },
  {
    drug1: 'ciclosporin',
    drug2: 'methotrexate',
    severity: 'serious',
    source: 'us-label',
    description: 'Combined toxicity, including kidney injury.',
    clinicalAdvice: 'Avoid together outside specialist regimens.',
  },
  {
    drug1: 'ciclosporin',
    drug2: 'cotrimoxazole',
    severity: 'serious',
    source: 'us-label',
    description: 'Combined nephrotoxicity.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'ciclosporin',
    drug2: 'tinidazole',
    severity: 'moderate',
    source: 'us-label',
    description: 'Tinidazole may raise ciclosporin levels.',
    clinicalAdvice: 'Monitor for ciclosporin toxicity.',
  },
  {
    drug1: 'bedaquiline',
    drug2: 'efavirenz',
    severity: 'serious',
    source: 'us-label',
    description: 'Efavirenz lowers bedaquiline levels, risking TB treatment failure.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'bedaquiline',
    drug2: 'rifabutin',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifabutin lowers bedaquiline levels, risking TB treatment failure.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'calcium gluconate',
    drug2: 'ceftriaxone',
    severity: 'serious',
    source: 'us-label',
    description: 'Ceftriaxone and calcium form precipitates. Fatal reactions have occurred in neonates.',
    clinicalAdvice: 'Contraindicated in neonates up to 28 days. At other ages, never give in the same line or at the same time.',
  },
  {
    drug1: 'ringer',
    drug2: 'ceftriaxone',
    severity: 'serious',
    source: 'us-label',
    description: "Ceftriaxone and the calcium in Ringer's lactate form precipitates. Fatal reactions have occurred in neonates.",
    clinicalAdvice: 'Contraindicated in neonates up to 28 days. At other ages, flush the line between them.',
  },
  {
    drug1: 'ringer',
    drug2: 'lithium',
    severity: 'serious',
    source: 'us-label',
    description: 'Sodium load changes lithium levels.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'lopinavir',
    drug2: 'carbamazepine',
    severity: 'serious',
    source: 'us-label',
    description: 'Carbamazepine lowers lopinavir levels.',
    clinicalAdvice: 'Do not use once-daily lopinavir/ritonavir; give it twice daily.',
  },
  {
    drug1: 'lopinavir',
    drug2: 'phenobarbital',
    severity: 'serious',
    source: 'us-label',
    description: 'Phenobarbital lowers lopinavir levels.',
    clinicalAdvice: 'Do not use once-daily lopinavir/ritonavir; give it twice daily.',
  },
  {
    drug1: 'lopinavir',
    drug2: 'phenytoin',
    severity: 'serious',
    source: 'us-label',
    description: 'Phenytoin lowers lopinavir levels.',
    clinicalAdvice: 'Do not use once-daily lopinavir/ritonavir; give it twice daily.',
  },
  {
    drug1: 'lopinavir',
    drug2: 'nevirapine',
    severity: 'serious',
    source: 'us-label',
    description: 'Nevirapine lowers lopinavir levels.',
    clinicalAdvice: 'Do not use once-daily lopinavir/ritonavir; give it twice daily.',
  },
  {
    drug1: 'lopinavir',
    drug2: 'efavirenz',
    severity: 'serious',
    source: 'us-label',
    description: 'Efavirenz lowers lopinavir levels.',
    clinicalAdvice: 'Do not use once-daily lopinavir/ritonavir; give it twice daily.',
  },
  {
    drug1: 'carbamazepine',
    drug2: 'tramadol',
    severity: 'serious',
    source: 'us-label',
    description: 'Carbamazepine speeds tramadol breakdown and tramadol lowers the seizure threshold.',
    clinicalAdvice: 'Not recommended.',
  },
  {
    drug1: 'sofosbuvir',
    drug2: 'carbamazepine',
    severity: 'serious',
    source: 'us-label',
    description: 'Carbamazepine lowers sofosbuvir levels, risking hepatitis C treatment failure.',
    clinicalAdvice: 'Not recommended.',
  },
  {
    drug1: 'sofosbuvir',
    drug2: 'phenytoin',
    severity: 'serious',
    source: 'us-label',
    description: 'Phenytoin lowers sofosbuvir levels, risking hepatitis C treatment failure.',
    clinicalAdvice: 'Not recommended.',
  },
  {
    drug1: 'sofosbuvir',
    drug2: 'phenobarbital',
    severity: 'serious',
    source: 'us-label',
    description: 'Phenobarbital lowers sofosbuvir levels, risking hepatitis C treatment failure.',
    clinicalAdvice: 'Not recommended.',
  },
  {
    drug1: 'sofosbuvir',
    drug2: 'rifampicin',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifampin lowers sofosbuvir levels, risking hepatitis C treatment failure.',
    clinicalAdvice: 'Not recommended.',
  },
  {
    drug1: 'sofosbuvir',
    drug2: 'rifabutin',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifabutin lowers sofosbuvir levels, risking hepatitis C treatment failure.',
    clinicalAdvice: 'Not recommended.',
  },
  {
    drug1: 'velpatasvir',
    drug2: 'omeprazole',
    severity: 'serious',
    source: 'us-label',
    description: 'Omeprazole lowers velpatasvir absorption.',
    clinicalAdvice: 'Not recommended. If essential, give sofosbuvir/velpatasvir with food 4 hours before omeprazole 20 mg.',
  },
  {
    drug1: 'velpatasvir',
    drug2: 'efavirenz',
    severity: 'serious',
    source: 'us-label',
    description: 'Efavirenz lowers velpatasvir levels.',
    clinicalAdvice: 'Not recommended.',
  },
  {
    drug1: 'levodopa',
    drug2: 'linezolid',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Linezolid is a non-selective MAO inhibitor; with levodopa it risks hypertensive crisis.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'cefazolin',
    drug2: 'rifampicin',
    severity: 'serious',
    source: 'us-label',
    description: 'Together they can cause vitamin K-dependent bleeding.',
    clinicalAdvice: 'Avoid in patients at risk of bleeding. Monitor clotting.',
  },
  {
    drug1: 'chloroquine',
    drug2: 'tamoxifen',
    severity: 'serious',
    source: 'us-label',
    description: 'Both can damage the retina.',
    clinicalAdvice: 'Not recommended.',
  },
  {
    drug1: 'ciprofloxacin',
    drug2: 'phenytoin',
    severity: 'moderate',
    source: 'us-label',
    description: 'Ciprofloxacin alters phenytoin levels.',
    clinicalAdvice: 'Monitor phenytoin levels.',
  },
  {
    drug1: 'clomipramine',
    drug2: 'linezolid',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Risk of serotonin syndrome with an MAO inhibitor.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'clomipramine',
    drug2: 'methylene blue',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Risk of serotonin syndrome with an MAO inhibitor.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'fluoxetine',
    drug2: 'linezolid',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Risk of serotonin syndrome with an MAO inhibitor.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'fluoxetine',
    drug2: 'methylene blue',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Risk of serotonin syndrome with an MAO inhibitor.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'sertraline',
    drug2: 'linezolid',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Risk of serotonin syndrome with an MAO inhibitor.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'sertraline',
    drug2: 'methylene blue',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Risk of serotonin syndrome with an MAO inhibitor.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'imipramine',
    drug2: 'linezolid',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Risk of serotonin syndrome with an MAO inhibitor.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'imipramine',
    drug2: 'methylene blue',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Risk of serotonin syndrome with an MAO inhibitor.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'imipramine',
    drug2: 'adrenaline',
    severity: 'serious',
    source: 'us-label',
    description: 'Tricyclics greatly increase the blood-pressure effect of adrenaline and noradrenaline.',
    clinicalAdvice: 'Avoid, including local anaesthetics that contain adrenaline.',
  },
  {
    drug1: 'fluoxetine',
    drug2: 'warfarin',
    severity: 'moderate',
    source: 'us-label',
    description: 'SSRIs with warfarin raise the risk of bleeding.',
    clinicalAdvice: 'Monitor INR and watch for bleeding.',
  },
  {
    drug1: 'daclatasvir',
    drug2: 'rifampicin',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifampin sharply lowers daclatasvir levels.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'dextran',
    drug2: 'heparin',
    severity: 'serious',
    source: 'us-label',
    description: 'Dextran adds to the bleeding risk of anticoagulation.',
    clinicalAdvice: 'Avoid in patients with anticoagulant-induced clotting defects.',
  },
  {
    drug1: 'dextran',
    drug2: 'warfarin',
    severity: 'serious',
    source: 'us-label',
    description: 'Dextran adds to the bleeding risk of anticoagulation.',
    clinicalAdvice: 'Avoid in patients with anticoagulant-induced clotting defects.',
  },
  {
    drug1: 'digoxin',
    drug2: 'nifedipine',
    severity: 'moderate',
    source: 'us-label',
    description: 'Nifedipine may raise digoxin levels.',
    clinicalAdvice: 'Monitor digoxin levels when starting or changing nifedipine.',
  },
  {
    drug1: 'dolutegravir',
    drug2: 'nevirapine',
    severity: 'serious',
    source: 'us-label',
    description: 'Nevirapine lowers dolutegravir levels.',
    clinicalAdvice: 'Not recommended.',
  },
  {
    drug1: 'zidovudine',
    drug2: 'doxorubicin',
    severity: 'serious',
    source: 'us-label',
    description: 'Combined bone marrow suppression.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'efavirenz',
    drug2: 'nevirapine',
    severity: 'serious',
    source: 'us-label',
    description: 'Two NNRTIs together add toxicity with no benefit.',
    clinicalAdvice: 'Not recommended.',
  },
  {
    drug1: 'efavirenz',
    drug2: 'praziquantel',
    severity: 'serious',
    source: 'us-label',
    description: 'Efavirenz lowers praziquantel levels, risking treatment failure.',
    clinicalAdvice: 'Avoid unless the benefit outweighs the risk.',
  },
  {
    drug1: 'efavirenz',
    drug2: 'simeprevir',
    severity: 'serious',
    source: 'us-label',
    description: 'Efavirenz lowers simeprevir levels.',
    clinicalAdvice: 'Not recommended.',
  },
  {
    drug1: 'itraconazole',
    drug2: 'ergometrine',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Itraconazole raises ergot levels, risking ergotism.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'itraconazole',
    drug2: 'ergotamine',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Itraconazole raises ergot levels, risking ergotism.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'itraconazole',
    drug2: 'irinotecan',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Itraconazole raises irinotecan toxicity.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'itraconazole',
    drug2: 'methadone',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Itraconazole raises methadone levels, risking QT prolongation and respiratory depression.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'itraconazole',
    drug2: 'midazolam',
    severity: 'serious',
    source: 'us-label',
    description: 'Itraconazole raises midazolam levels. Oral midazolam is contraindicated.',
    clinicalAdvice: 'Give parenteral midazolam only with monitoring.',
  },
  {
    drug1: 'itraconazole',
    drug2: 'rifampicin',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifampin lowers itraconazole levels, risking treatment failure.',
    clinicalAdvice: 'Not recommended.',
  },
  {
    drug1: 'ergotamine',
    drug2: 'glyceryl trinitrate',
    severity: 'serious',
    source: 'us-label',
    description: 'Ergotamine opposes nitrate vasodilation.',
    clinicalAdvice: 'Avoid ergotamine in patients using sublingual glyceryl trinitrate.',
  },
  {
    drug1: 'erythromycin',
    drug2: 'fluconazole',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Both prolong the QT interval.',
    clinicalAdvice: 'Do not co-prescribe.',
  },
  {
    drug1: 'erythromycin',
    drug2: 'moxifloxacin',
    severity: 'serious',
    source: 'us-label',
    description: 'Both prolong the QT interval.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'ferrous',
    drug2: 'methyldopa',
    severity: 'serious',
    source: 'us-label',
    description: 'Iron lowers methyldopa absorption.',
    clinicalAdvice: 'Not recommended. Separate doses if both are needed.',
  },
  {
    drug1: 'irinotecan',
    drug2: 'rifampicin',
    severity: 'serious',
    source: 'us-label',
    description: 'Strong CYP3A4 inducers lower irinotecan levels.',
    clinicalAdvice: 'Do not use together unless there is no alternative.',
  },
  {
    drug1: 'irinotecan',
    drug2: 'phenytoin',
    severity: 'serious',
    source: 'us-label',
    description: 'Strong CYP3A4 inducers lower irinotecan levels.',
    clinicalAdvice: 'Do not use together unless there is no alternative.',
  },
  {
    drug1: 'irinotecan',
    drug2: 'carbamazepine',
    severity: 'serious',
    source: 'us-label',
    description: 'Strong CYP3A4 inducers lower irinotecan levels.',
    clinicalAdvice: 'Do not use together unless there is no alternative.',
  },
  {
    drug1: 'irinotecan',
    drug2: 'phenobarbital',
    severity: 'serious',
    source: 'us-label',
    description: 'Strong CYP3A4 inducers lower irinotecan levels.',
    clinicalAdvice: 'Do not use together unless there is no alternative.',
  },
  {
    drug1: 'isoniazid',
    drug2: 'phenytoin',
    severity: 'moderate',
    source: 'us-label',
    description: 'Isoniazid raises phenytoin levels.',
    clinicalAdvice: 'Monitor and adjust the phenytoin dose.',
  },
  {
    drug1: 'cotrimoxazole',
    drug2: 'calcium folinate',
    severity: 'serious',
    source: 'us-label',
    description: 'Folinic acid with co-trimoxazole for Pneumocystis pneumonia has caused treatment failure and death.',
    clinicalAdvice: 'Avoid during PCP treatment.',
  },
  {
    drug1: 'cotrimoxazole',
    drug2: 'pyrimethamine',
    severity: 'serious',
    source: 'us-label',
    description: 'Both are antifolates; together they can cause megaloblastic anaemia.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'mebendazole',
    drug2: 'metronidazole',
    severity: 'serious',
    source: 'us-label',
    description: 'Together they have caused Stevens-Johnson syndrome and toxic epidermal necrolysis.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'methotrexate',
    drug2: 'nitrous oxide',
    severity: 'serious',
    source: 'us-label',
    description: 'Nitrous oxide adds to methotrexate folate depletion.',
    clinicalAdvice: 'Avoid nitrous oxide anaesthesia during methotrexate.',
  },
  {
    drug1: 'mifepristone',
    drug2: 'rifampicin',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifampin lowers mifepristone levels.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'nifedipine',
    drug2: 'phenytoin',
    severity: 'serious',
    source: 'us-label',
    description: 'CYP3A4 inducers lower nifedipine levels, losing its effect.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'nifedipine',
    drug2: 'rifampicin',
    severity: 'serious',
    source: 'us-label',
    description: 'CYP3A4 inducers lower nifedipine levels, losing its effect.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'nifedipine',
    drug2: 'carbamazepine',
    severity: 'serious',
    source: 'us-label',
    description: 'CYP3A4 inducers lower nifedipine levels, losing its effect.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'omeprazole',
    drug2: 'rifampicin',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifampin lowers omeprazole levels.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'praziquantel',
    drug2: 'rifampicin',
    severity: 'contraindicated',
    source: 'us-label',
    description: 'Rifampin lowers praziquantel levels, risking treatment failure.',
    clinicalAdvice: 'Do not co-prescribe. Stop rifampin 4 weeks before praziquantel when possible.',
  },
  {
    drug1: 'quinine',
    drug2: 'rifampicin',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifampin lowers quinine levels, risking malaria treatment failure.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'rifampicin',
    drug2: 'simeprevir',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifampin lowers simeprevir levels.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'rifampicin',
    drug2: 'zidovudine',
    severity: 'serious',
    source: 'us-label',
    description: 'Rifampin lowers zidovudine levels.',
    clinicalAdvice: 'Avoid together.',
  },
  {
    drug1: 'tinidazole',
    drug2: 'warfarin',
    severity: 'moderate',
    source: 'us-label',
    description: 'Tinidazole may increase the effect of warfarin.',
    clinicalAdvice: 'Monitor INR during and for 8 days after tinidazole.',
  },
];

/**
 * Check for drug interactions between a list of medications.
 */
function findInteractions(pairs: [string, string][]): InteractionCheckResult {
  const found: DrugInteraction[] = [];

  for (const [med1, med2] of pairs) {
    for (const interaction of INTERACTION_DATABASE) {
      const d1 = normalize(interaction.drug1);
      const d2 = normalize(interaction.drug2);

      // Check both directions: (med1↔d1, med2↔d2) or (med1↔d2, med2↔d1)
      if (
        (med1.includes(d1) && med2.includes(d2)) ||
        (med1.includes(d2) && med2.includes(d1)) ||
        (d1.includes(med1) && d2.includes(med2)) ||
        (d1.includes(med2) && d2.includes(med1))
      ) {
        // Avoid duplicate entries
        const key = `${interaction.drug1}|${interaction.drug2}`;
        if (!found.some(f => `${f.drug1}|${f.drug2}` === key)) {
          found.push(interaction);
        }
      }
    }
  }

  // Sort by severity
  const severityOrder: Record<InteractionSeverity, number> = {
    contraindicated: 0,
    serious: 1,
    moderate: 2,
  };
  found.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    hasInteractions: found.length > 0,
    interactions: found,
    highestSeverity: found.length > 0 ? found[0].severity : null,
  };
}

export function checkInteractions(medications: string[]): InteractionCheckResult {
  if (!medications || medications.length < 2) {
    return { hasInteractions: false, interactions: [], highestSeverity: null };
  }

  const normalized = medications.map(interactionName).filter(Boolean);
  const pairs: [string, string][] = [];
  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      pairs.push([normalized[i], normalized[j]]);
    }
  }
  return findInteractions(pairs);
}

/**
 * Check a new prescription against a patient's existing medications.
 * Returns only interactions between the new drug and a current one: a pair
 * already on the chart was answered when it was ordered, and asking again on
 * every later order for that patient teaches prescribers to ignore the stop.
 */
export function checkNewPrescription(
  newMedication: string,
  currentMedications: string[]
): InteractionCheckResult {
  const med = interactionName(newMedication);
  if (!med) return findInteractions([]);
  return findInteractions(
    currentMedications.map(interactionName).filter(Boolean).map(current => [med, current]),
  );
}

/**
 * Get all known interactions for a specific medication.
 */
export function getInteractionsForDrug(medication: string): DrugInteraction[] {
  const med = interactionName(medication);
  return INTERACTION_DATABASE.filter(i =>
    normalize(i.drug1).includes(med) || normalize(i.drug2).includes(med) ||
    med.includes(normalize(i.drug1)) || med.includes(normalize(i.drug2))
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Drug–allergy checking
// Maps a recorded allergy term to the drug names / class members it should
// flag. Both directions are substring-matched so "penicillin allergy" trips on
// "Amoxicillin 500mg" and a recorded "amoxicillin" allergy trips on the same.
// ─────────────────────────────────────────────────────────────────────────
const SULFONAMIDES = ['cotrimoxazole', 'co-trimoxazole', 'septrin', 'bactrim', 'sulfamethoxazole', 'sulphamethoxazole', 'sulfadoxine', 'sulphadoxine', 'sulfasalazine', 'sulfadiazine', 'sulphadiazine'];

const ALLERGY_CLASS_MEMBERS: Record<string, string[]> = {
  penicillin: ['penicillin', 'amoxicillin', 'ampicillin', 'flucloxacillin', 'cloxacillin', 'co-amoxiclav', 'amoxiclav', 'benzylpenicillin', 'piperacillin', 'augmentin', 'tazocin', 'benzathine', 'phenoxymethylpenicillin'],
  sulfa: SULFONAMIDES,
  sulpha: SULFONAMIDES,
  sulfonamide: SULFONAMIDES,
  nsaid: ['ibuprofen', 'diclofenac', 'aspirin', 'naproxen', 'indomethacin', 'ketorolac', 'mefenamic', 'piroxicam', 'meloxicam', 'ketoprofen', 'celecoxib'],
  aspirin: ['aspirin', 'acetylsalicylic'],
  cephalosporin: ['ceftriaxone', 'cefixime', 'cefuroxime', 'cephalexin', 'cefalexin', 'cefotaxime', 'cefazolin', 'ceftazidime', 'cefpodoxime', 'cefaclor', 'cefepime'],
  // The mefloquine and quinine US labels each list hypersensitivity to the other.
  quinine: ['quinine', 'quinidine', 'mefloquine'],
  sulphonamide: SULFONAMIDES,
  aminoglycoside: ['gentamicin', 'amikacin', 'kanamycin', 'streptomycin', 'paromomycin', 'tobramycin'],
  fluoroquinolone: ['ciprofloxacin', 'levofloxacin', 'moxifloxacin'],
  macrolide: ['azithromycin', 'erythromycin'],
  tetracycline: ['tetracycline', 'doxycycline', 'oxytetracycline'],
  'ace inhibitor': ['enalapril', 'lisinopril', 'captopril'],
  'local anaesthetic': ['lidocaine', 'lignocaine', 'bupivacaine', 'tetracaine'],
  iodine: ['iodine', 'iohexol', 'amidotrizoate', 'contrast dye', 'contrast medium'],
};

export interface AllergyAlert {
  medication: string;
  allergy: string;
  /** Why it matched: direct name hit vs same drug-class member. */
  reason: 'direct' | 'class';
}

/** Criticality-aware allergy alert (P0.3) used by the structured check. */
export interface StructuredAllergyAlert extends AllergyAlert {
  criticality: 'mild' | 'moderate' | 'severe' | 'unknown';
  /** Free-text reaction recorded for the allergy, if any. */
  reaction?: string;
  /**
   * Severe-criticality matches set this. The prescribing UI should require an
   * explicit, reasoned override before proceeding rather than silently warning
   * — without hard-blocking, so emergency care is never gated (see consultation
   * page: alerts are advisory by design).
   */
  requiresOverride: boolean;
}

/** Minimal shape this module needs from a structured allergy entry. */
export interface AllergyLike {
  substance: string;
  criticality?: 'mild' | 'moderate' | 'severe' | 'unknown';
  reaction?: string;
  status?: string;
}

/** Returns the drug-name fragments an allergy term should flag. */
function allergyTargets(allergy: string): string[] {
  const a = normalize(allergy);
  const targets = new Set<string>([a]);
  for (const [klass, members] of Object.entries(ALLERGY_CLASS_MEMBERS)) {
    if (a.includes(klass) || members.some(m => a.includes(m))) {
      members.forEach(m => targets.add(m));
      targets.add(klass);
    }
  }
  return [...targets].filter(Boolean);
}

/**
 * The medicine as allergy matching should read it. "sulfa" sits inside
 * "sulfate", and a sulfate salt is not a sulfonamide: without this a sulfa
 * allergy flags zinc, ferrous and magnesium sulfate, and an unknown-severity
 * entry then stops eclampsia treatment for a written reason. An allergy that
 * names the sulfate itself still matches.
 */
function medicationForAllergy(medication: string, allergy: string): string {
  const med = normalize(medication);
  if (/sul(f|ph)ate/.test(normalize(allergy))) return med;
  return med.replace(/\bsul(f|ph)ates?\b/g, '').trim() || med;
}

/**
 * Cross-check a list of medications against a patient's recorded allergies.
 * Class-aware (penicillin allergy flags amoxicillin, etc.).
 */
export function checkAllergies(medications: string[], allergies: string[]): AllergyAlert[] {
  const alerts: AllergyAlert[] = [];
  const meds = (medications || []).filter(m => m?.trim());
  const allgs = (allergies || [])
    .filter(Boolean)
    .filter(a => !isNoAllergySentinel(a));
  for (const allergy of allgs) {
    const targets = allergyTargets(allergy);
    for (const med of meds) {
      const m = medicationForAllergy(med, allergy);
      const direct = m.includes(normalize(allergy)) || normalize(allergy).includes(m);
      const klass = targets.some(t => t.length >= 4 && m.includes(t));
      if (direct || klass) {
        alerts.push({ medication: med, allergy, reason: direct ? 'direct' : 'class' });
      }
    }
  }
  return alerts;
}

/**
 * Criticality-aware drug–allergy check (P0.3). Same class-aware matching as
 * {@link checkAllergies}, but driven by structured allergy entries so each
 * alert carries the recorded criticality and reaction, and severe matches are
 * flagged `requiresOverride` for the prescribing UI to escalate.
 *
 * Only `active` allergies are considered. Inactive / resolved / entered-in-error
 * entries are ignored.
 */
export function checkAllergiesStructured(
  medications: string[],
  allergies: AllergyLike[],
): StructuredAllergyAlert[] {
  const alerts: StructuredAllergyAlert[] = [];
  const meds = (medications || []).filter(m => m?.trim());
  const allgs = (allergies || [])
    .filter((a) => a && a.substance && (a.status === undefined || a.status === 'active'))
    .filter((a) => !isNoAllergySentinel(a.substance));
  for (const allergy of allgs) {
    const targets = allergyTargets(allergy.substance);
    for (const med of meds) {
      const m = medicationForAllergy(med, allergy.substance);
      const direct = m.includes(normalize(allergy.substance)) || normalize(allergy.substance).includes(m);
      const klass = targets.some((t) => t.length >= 4 && m.includes(t));
      if (direct || klass) {
        const criticality = allergy.criticality ?? 'unknown';
        alerts.push({
          medication: med,
          allergy: allergy.substance,
          reason: direct ? 'direct' : 'class',
          criticality,
          reaction: allergy.reaction,
          // Fail-safe: a severe match clearly needs an override, but so does an
          // 'unknown'-criticality match (common for migrated/legacy allergies) —
          // we must not silently treat "we don't know" as safe. Only explicitly
          // mild/moderate matches stay advisory.
          requiresOverride: criticality === 'severe' || criticality === 'unknown',
        });
      }
    }
  }
  return alerts;
}

/** Dose/strength/form tokens to drop when keying a medication by its drug name. */
const DOSE_FORM_TOKENS = new Set([
  'mg', 'g', 'mcg', 'ug', 'ml', 'l', 'iu', 'u', 'meq', 'mmol', '%',
  'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules',
  'syrup', 'suspension', 'susp', 'solution', 'soln', 'drops', 'cream', 'ointment',
  'injection', 'inj', 'vial', 'amp', 'ampoule', 'sachet', 'suppository',
  'oral', 'iv', 'im', 'sc', 'po', 'pr', 'od', 'bd', 'tds', 'qds', 'prn', 'stat', 'x',
]);

/**
 * Key a medication on its full drug name, stripping dose/strength/form tokens.
 * Keeps multi-word/combination names intact ("artemether-lumefantrine"), so
 * "Amoxicillin 250mg" and "Amoxicillin 500mg" collide (same drug) while
 * "Artemether-Lumefantrine" and "Artemether" do NOT (different drugs).
 */
function drugNameKey(med: string): string {
  return normalize(med)
    .split(/[\s,]+/)
    .filter((tok) => tok && !/\d/.test(tok) && !DOSE_FORM_TOKENS.has(tok))
    .join(' ')
    .trim();
}

/**
 * Detect duplicate / therapeutic-overlap orders within a single medication
 * list (same drug ordered twice). Returns the duplicated drug display names.
 */
export function findDuplicateMedications(medications: string[]): string[] {
  const seen = new Map<string, string>();
  const dupes = new Set<string>();
  for (const med of (medications || []).filter(Boolean)) {
    const key = drugNameKey(med);
    if (!key) continue;
    if (seen.has(key)) dupes.add(seen.get(key)!);
    else seen.set(key, med);
  }
  return [...dupes];
}
