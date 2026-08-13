'use client';

import { forwardRef } from 'react';
import type { CSSProperties, ForwardRefExoticComponent, RefAttributes, SVGProps } from 'react';
import * as Lucide from 'lucide-react';


export type IconName = string;

type LucideComponent = React.ComponentType<Lucide.LucideProps>;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'color' | 'ref'> {
  name: IconName;
  size?: number | string;
  color?: string;
  accent?: string;
  strokeWidth?: number | string;
  flat?: boolean;
  style?: CSSProperties;
  ref?: React.Ref<SVGSVGElement>;
}

/**
 * The default line-icon colour. A CSS variable, not the BRAND_PRIMARY literal:
 * lucide writes `color` out as a literal `stroke=` presentation attribute, so
 * a hex here froze every default icon at the platform blue and no amount of
 * org branding could repaint it. Presentation attributes do resolve var(), so
 * the token reaches the glyph.
 */
export const BLUE_LINE_ICON = 'var(--accent-primary)';

export const CATEGORY_ACCENTS: Record<string, string> = {
  clinical: BLUE_LINE_ICON,
  services: BLUE_LINE_ICON,
  'vital-events': BLUE_LINE_ICON,
  vitals: BLUE_LINE_ICON,
  ui: BLUE_LINE_ICON,
};

const ICON_COMPONENTS: Record<string, keyof typeof Lucide> = {
  activity: 'Activity',
  alert: 'MessageSquareWarning',
  apple: 'Apple',
  archive: 'Archive',
  arrowDownLeft: 'ArrowDownLeft',
  arrowDownRight: 'ArrowDownRight',
  arrowRight: 'ArrowRight',
  arrowRightLeft: 'ArrowRightLeft',
  arrowUpDown: 'ArrowUpDown',
  arrowUpRight: 'ArrowUpRight',
  baby: 'Baby',
  ban: 'Ban',
  bandage: 'Bandage',
  banknote: 'Banknote',
  barChart: 'ChartNoAxesCombined',
  bedDouble: 'BedDouble',
  bell: 'Bell',
  bellOff: 'BellOff',
  bloodPressure: 'Droplet',
  brain: 'Brain',
  bug: 'Bug',
  building: 'Building2',
  calendar: 'CalendarDays',
  camera: 'Camera',
  chart: 'ChartNoAxesCombined',
  check: 'Check',
  chevronDown: 'ChevronDown',
  chevronLeft: 'ChevronLeft',
  chevronRight: 'ChevronRight',
  chevronUp: 'ChevronUp',
  claim: 'ClipboardCheck',
  clock: 'Clock',
  close: 'X',
  cloudOff: 'CloudOff',
  code: 'Code2',
  consultation: 'Stethoscope',
  copy: 'Copy',
  cpu: 'Cpu',
  creditCard: 'CreditCard',
  diagnosis: 'ClipboardPen',
  dollarSign: 'DollarSign',
  download: 'Download',
  edit: 'Pencil',
  externalLink: 'ExternalLink',
  eye: 'Eye',
  eyeOff: 'EyeOff',
  fileJson: 'FileJson',
  fileSpreadsheet: 'FileSpreadsheet',
  fileText: 'FileText',
  fileUp: 'FileUp',
  flag: 'Flag',
  flask: 'FlaskConical',
  folderOpen: 'FolderOpen',
  gauge: 'Gauge',
  gift: 'Gift',
  gitBranch: 'GitBranch',
  gitCompare: 'GitCompareArrows',
  globe: 'Globe2',
  hardDrive: 'HardDrive',
  heart: 'HeartPulse',
  helpCircle: 'CircleHelp',
  history: 'History',
  home: 'House',
  hospital: 'Hospital',
  image: 'Image',
  info: 'Info',
  keyRound: 'KeyRound',
  keyboard: 'Keyboard',
  languages: 'Languages',
  layers: 'Layers',
  layoutDashboard: 'LayoutDashboard',
  lineChart: 'ChartNoAxesCombined',
  list: 'List',
  loader: 'LoaderCircle',
  lock: 'Lock',
  logIn: 'LogIn',
  logout: 'LogOut',
  lungs: 'Wind',
  mail: 'Mail',
  mapPin: 'MapPin',
  maximize: 'Maximize2',
  mch: 'HeartPulse',
  // Lucide's real hamburger (three lines). This was 'PanelLeft', which drew a
  // sidebar glyph on the top rail's module-menu trigger.
  menu: 'Menu',
  message: 'MessageSquare',
  mic: 'Mic',
  micOff: 'MicOff',
  microscope: 'Microscope',
  minus: 'Minus',
  mobileMoney: 'Smartphone',
  monitorSmartphone: 'MonitorSmartphone',
  moon: 'Moon',
  moreVertical: 'MoreVertical',
  navigation: 'Send',
  network: 'Network',
  oxygen: 'Droplets',
  package: 'Package',
  palette: 'Palette',
  paperclip: 'Paperclip',
  patient: 'UserRound',
  pause: 'Pause',
  phone: 'Phone',
  phoneOff: 'PhoneOff',
  pieChart: 'ChartPie',
  pill: 'Pill',
  play: 'Play',
  plus: 'Plus',
  pregnant: 'HeartPulse',
  prescription: 'ClipboardList',
  printer: 'Printer',
  pulse: 'Activity',
  qr: 'QrCode',
  radio: 'RadioTower',
  receipt: 'Receipt',
  record: 'FileText',
  referral: 'Send',
  refresh: 'RefreshCw',
  rotate: 'RotateCcw',
  save: 'Save',
  search: 'Search',
  send: 'Send',
  sendHorizontal: 'SendHorizontal',
  server: 'Database',
  settings: 'Settings',
  shield: 'ShieldCheck',
  shoppingCart: 'ShoppingCart',
  signal: 'Signal',
  skull: 'Skull',
  sliders: 'SlidersHorizontal',
  sparkle: 'Sparkles',
  square: 'Square',
  star: 'Star',
  stethoscope: 'Stethoscope',
  sun: 'Sun',
  surveillance: 'ChartNoAxesCombined',
  table: 'Table',
  target: 'Target',
  thermometer: 'Thermometer',
  thumbsUp: 'ThumbsUp',
  timeline: 'GitBranch',
  timer: 'Timer',
  toggleLeft: 'ToggleLeft',
  toggleRight: 'ToggleRight',
  trash: 'Trash2',
  trendingDown: 'TrendingDown',
  trendingUp: 'TrendingUp',
  triage: 'Siren',
  truck: 'Truck',
  upload: 'Upload',
  user: 'UserRound',
  users: 'UsersRound',
  userX: 'UserX',
  utensils: 'Utensils',
  utensilsCrossed: 'UtensilsCrossed',
  vaccine: 'Syringe',
  video: 'Video',
  wallet: 'Wallet',
  weight: 'Scale',
  wifi: 'Wifi',
  wifiOff: 'WifiOff',
  wind: 'Wind',
  zap: 'Zap',
  zapOff: 'ZapOff',
};

function resolveLucide(name: string): LucideComponent {
  const componentName = ICON_COMPONENTS[name] || ICON_COMPONENTS.record;
  const Component = Lucide[componentName] as unknown as LucideComponent | undefined;
  return Component || (Lucide.Square as LucideComponent);
}

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  {
    name,
    size = 24,
    color,
    accent,
    strokeWidth = 1.8,
    flat: _flat,
    style,
    ...rest
  },
  ref,
) {
  const Component = resolveLucide(name);
  return (
    <Component
      ref={ref}
      size={size}
      color={accent || color || BLUE_LINE_ICON}
      strokeWidth={Number(strokeWidth) || 1.8}
      fill="none"
      style={style}
      {...rest}
    />
  );
});

Icon.displayName = 'Icon';

type LucideLikeIcon = ForwardRefExoticComponent<
  Omit<SVGProps<SVGSVGElement>, 'ref' | 'color'> & {
    size?: number | string;
    color?: string;
    accent?: string;
    strokeWidth?: number | string;
    absoluteStrokeWidth?: boolean;
  } & RefAttributes<SVGSVGElement>
>;

function makeLucide(name: IconName): LucideLikeIcon {
  const Component = forwardRef<SVGSVGElement, Omit<IconProps, 'name'>>((props, ref) => (
    <Icon ref={ref} name={name} {...props} />
  )) as LucideLikeIcon;
  Component.displayName = `Icon${name}`;
  return Component;
}

export const DuotoneStethoscope = makeLucide('stethoscope');
export const DuotoneMessage = makeLucide('message');
export const DuotoneCalendar = makeLucide('calendar');
export const DuotoneRecord = makeLucide('record');
export const DuotoneFlask = makeLucide('flask');
export const DuotonePill = makeLucide('pill');
export const DuotoneWallet = makeLucide('wallet');
export const DuotoneClaim = makeLucide('claim');
export const DuotoneReceipt = makeLucide('receipt');
export const DuotoneCreditCard = makeLucide('creditCard');
export const DuotoneMobileMoney = makeLucide('mobileMoney');
export const DuotoneVaccine = makeLucide('vaccine');
export const DuotoneBaby = makeLucide('baby');
export const DuotoneSkull = makeLucide('skull');
export const DuotoneMCH = makeLucide('mch');
export const DuotoneHeart = makeLucide('heart');
export const DuotoneBloodPressure = makeLucide('bloodPressure');
export const DuotoneThermometer = makeLucide('thermometer');
export const DuotoneWeight = makeLucide('weight');
export const DuotoneBuilding = makeLucide('building');
export const DuotoneHospital = makeLucide('hospital');
export const DuotoneWifi = makeLucide('wifi');
export const DuotoneWifiOff = makeLucide('wifiOff');
export const DuotoneSearch = makeLucide('search');
export const DuotoneAlert = makeLucide('alert');
export const DuotoneChevronLeft = makeLucide('chevronLeft');
export const DuotoneChevronRight = makeLucide('chevronRight');
export const DuotoneChevronDown = makeLucide('chevronDown');
export const DuotoneChevronUp = makeLucide('chevronUp');
export const DuotoneQR = makeLucide('qr');
export const DuotonePhone = makeLucide('phone');
export const DuotoneMapPin = makeLucide('mapPin');
export const DuotoneClock = makeLucide('clock');
export const DuotoneEdit = makeLucide('edit');
export const DuotonePrinter = makeLucide('printer');
export const DuotoneDownload = makeLucide('download');
export const DuotoneShield = makeLucide('shield');
export const DuotoneSparkle = makeLucide('sparkle');
export const DuotoneCheck = makeLucide('check');
export const DuotoneClose = makeLucide('close');
export const DuotoneMenu = makeLucide('menu');
export const DuotoneBell = makeLucide('bell');
export const DuotoneMoon = makeLucide('moon');
export const DuotoneSun = makeLucide('sun');
export const DuotoneGlobe = makeLucide('globe');
export const DuotoneSettings = makeLucide('settings');
export const DuotoneLogout = makeLucide('logout');
export const DuotoneUser = makeLucide('user');
export const DuotoneArrowRight = makeLucide('arrowRight');
export const DuotoneArrowRightLeft = makeLucide('arrowRightLeft');
export const DuotonePlus = makeLucide('plus');
export const DuotoneVideo = makeLucide('video');
export const DuotoneBug = makeLucide('bug');
export const DuotoneActivity = makeLucide('activity');
export const DuotoneServer = makeLucide('server');
export const DuotoneBarChart = makeLucide('barChart');
export const DuotonePalette = makeLucide('palette');
export const DuotoneUsers = makeLucide('users');
export const DuotoneGauge = makeLucide('gauge');
export const DuotoneLayoutDashboard = makeLucide('layoutDashboard');
export const DuotoneFileText = makeLucide('fileText');
export const DuotoneHome = makeLucide('home');
export const DuotoneApple = makeLucide('apple');
export const DuotoneArchive = makeLucide('archive');
export const DuotoneArrowDownLeft = makeLucide('arrowDownLeft');
export const DuotoneArrowDownRight = makeLucide('arrowDownRight');
export const DuotoneArrowUpDown = makeLucide('arrowUpDown');
export const DuotoneArrowUpRight = makeLucide('arrowUpRight');
export const DuotoneBan = makeLucide('ban');
export const DuotoneBandage = makeLucide('bandage');
export const DuotoneBanknote = makeLucide('banknote');
export const DuotoneBedDouble = makeLucide('bedDouble');
export const DuotoneBellOff = makeLucide('bellOff');
export const DuotoneBrain = makeLucide('brain');
export const DuotoneCamera = makeLucide('camera');
export const DuotoneCode = makeLucide('code');
export const DuotoneCopy = makeLucide('copy');
export const DuotoneCpu = makeLucide('cpu');
export const DuotoneDollarSign = makeLucide('dollarSign');
export const DuotoneExternalLink = makeLucide('externalLink');
export const DuotoneEye = makeLucide('eye');
export const DuotoneEyeOff = makeLucide('eyeOff');
export const DuotoneFileJson = makeLucide('fileJson');
export const DuotoneFileSpreadsheet = makeLucide('fileSpreadsheet');
export const DuotoneFileUp = makeLucide('fileUp');
export const DuotoneFlag = makeLucide('flag');
export const DuotoneFolderOpen = makeLucide('folderOpen');
export const DuotoneGift = makeLucide('gift');
export const DuotoneGitBranch = makeLucide('gitBranch');
export const DuotoneGitCompare = makeLucide('gitCompare');
export const DuotoneHardDrive = makeLucide('hardDrive');
export const DuotoneHelpCircle = makeLucide('helpCircle');
export const DuotoneHistory = makeLucide('history');
export const DuotoneImage = makeLucide('image');
export const DuotoneInfo = makeLucide('info');
export const DuotoneKeyRound = makeLucide('keyRound');
export const DuotoneKeyboard = makeLucide('keyboard');
export const DuotoneLanguages = makeLucide('languages');
export const DuotoneLayers = makeLucide('layers');
export const DuotoneLineChart = makeLucide('lineChart');
export const DuotoneList = makeLucide('list');
export const DuotoneLoader = makeLucide('loader');
export const DuotoneLock = makeLucide('lock');
export const DuotoneLogIn = makeLucide('logIn');
export const DuotoneMail = makeLucide('mail');
export const DuotoneMaximize = makeLucide('maximize');
export const DuotoneMic = makeLucide('mic');
export const DuotoneMicOff = makeLucide('micOff');
export const DuotoneMicroscope = makeLucide('microscope');
export const DuotoneMinus = makeLucide('minus');
export const DuotoneMonitorSmartphone = makeLucide('monitorSmartphone');
export const DuotoneMoreVertical = makeLucide('moreVertical');
export const DuotoneNavigation = makeLucide('navigation');
export const DuotoneNetwork = makeLucide('network');
export const DuotonePackage = makeLucide('package');
export const DuotonePaperclip = makeLucide('paperclip');
export const DuotonePause = makeLucide('pause');
export const DuotonePhoneOff = makeLucide('phoneOff');
export const DuotonePieChart = makeLucide('pieChart');
export const DuotonePlay = makeLucide('play');
export const DuotoneRadio = makeLucide('radio');
export const DuotoneRefresh = makeLucide('refresh');
export const DuotoneRotate = makeLucide('rotate');
export const DuotoneSave = makeLucide('save');
export const DuotoneSend = makeLucide('send');
export const DuotoneSendHorizontal = makeLucide('sendHorizontal');
export const DuotoneShoppingCart = makeLucide('shoppingCart');
export const DuotoneSignal = makeLucide('signal');
export const DuotoneSliders = makeLucide('sliders');
export const DuotoneSquare = makeLucide('square');
export const DuotoneStar = makeLucide('star');
export const DuotoneTable = makeLucide('table');
export const DuotoneTarget = makeLucide('target');
export const DuotoneThumbsUp = makeLucide('thumbsUp');
export const DuotoneTimer = makeLucide('timer');
export const DuotoneToggleLeft = makeLucide('toggleLeft');
export const DuotoneToggleRight = makeLucide('toggleRight');
export const DuotoneTrash = makeLucide('trash');
export const DuotoneTrendingDown = makeLucide('trendingDown');
export const DuotoneTrendingUp = makeLucide('trendingUp');
export const DuotoneTruck = makeLucide('truck');
export const DuotoneUpload = makeLucide('upload');
export const DuotoneUserX = makeLucide('userX');
export const DuotoneUtensils = makeLucide('utensils');
export const DuotoneUtensilsCrossed = makeLucide('utensilsCrossed');
export const DuotoneWind = makeLucide('wind');
export const DuotoneZap = makeLucide('zap');
export const DuotoneZapOff = makeLucide('zapOff');

export default Icon;
