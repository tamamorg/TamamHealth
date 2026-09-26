/** Keep rail panel headings compact at tablet widths without changing desktop copy. */
const TABLET_TITLES: Record<string, string> = {
  'Day activity': 'Activity',
  'Day statistics': 'Statistics',
  'Arrivals by stage': 'Arrivals',
  'Today by acuity': 'Acuity',
  'Outstanding items': 'Items',
  'Patient flow': 'Flow',
  'Patient progress': 'Progress',
  'Specimens moving': 'Specimens',
  'Scripts moving': 'Scripts',
  'Imaging moving': 'Imaging',
  'Recent activity': 'Activity',
  'Data Entry Dashboard': 'Entry',
  'Nutrition Dashboard': 'Nutrition',
  'Radiology Dashboard': 'Radiology',
  'State Dashboard': 'State',
  'Pharmacy Operations': 'Pharmacy',
  'لوحة إدخال البيانات': 'إدخال',
  'لوحة التغذية': 'التغذية',
  'لوحة الأشعة': 'الأشعة',
  'لوحة الولاية': 'الولاية',
  'عمليات الصيدلية': 'الصيدلية',
  'Close the loop': 'Focus',
  'Keep every patient moving': 'Focus',
  'Keep the desk moving': 'Focus',
  'Answer every order': 'Focus',
  'Dispense freely': 'Focus',
  'Report every study': 'Focus',
  'Catch it early': 'Focus',
  'Keep the record complete': 'Focus',
  'Keep the picture current': 'Focus',
  'كمّل الشغل': 'التركيز',
  'خلي كل عيان يتحرك': 'التركيز',
  'خلي المكتب شغال': 'التركيز',
  'جاوب على كل طلب': 'التركيز',
  'صرف الدوا بحرية': 'التركيز',
  'بلّغ عن كل فحص': 'التركيز',
  'اكتشفها بدري': 'التركيز',
  'خلي السجل كامل': 'التركيز',
  'خلي الصورة محدّثة': 'التركيز',
};

export default function EhrPanelTitle({ title }: { title: string }) {
  const tabletTitle = TABLET_TITLES[title];
  return (
    <h2>
      {tabletTitle ? (
        <>
          <span className="ehr-panel-title-full">{title}</span>
          <span className="ehr-panel-title-tablet">{tabletTitle}</span>
        </>
      ) : title}
    </h2>
  );
}
