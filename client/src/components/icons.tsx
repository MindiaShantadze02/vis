import { forwardRef } from 'react'
import { styled } from '@mui/material/styles'
import type { SxProps, Theme } from '@mui/material/styles'
import type { Icon as PhosphorIcon, IconProps } from '@phosphor-icons/react'
// Import the (non-deprecated) `*Icon` names, aliased back to the bare names the
// mapping below uses — so the mapping stays readable and no deprecation hints.
import {
  ClockIcon as Clock, PlusIcon as Plus, ShieldCheckIcon as ShieldCheck,
  CaretLeftIcon as CaretLeft, CaretRightIcon as CaretRight, CaretDownIcon as CaretDown,
  CalendarBlankIcon as CalendarBlank, CalendarDotsIcon as CalendarDots,
  CalendarCheckIcon as CalendarCheck, CalendarXIcon as CalendarX, XCircleIcon as XCircle,
  CheckIcon as CheckGlyph, CheckCircleIcon as CheckCircle, XIcon as X,
  CoffeeIcon as Coffee, CopyIcon as Copy, CreditCardIcon as CreditCard,
  SquaresFourIcon as SquaresFour, TrashIcon as Trash, SparkleIcon as Sparkle,
  ProhibitIcon as Prohibit, PencilSimpleIcon as PencilSimple, WarningCircleIcon as WarningCircle,
  ArmchairIcon as Armchair, UsersThreeIcon as UsersThree, BedIcon as Bed,
  ChartLineUpIcon as ChartLineUp, SignInIcon as SignIn, SignOutIcon as SignOut,
  EnvelopeIcon as Envelope, ListIcon, BellIcon as Bell, ArrowSquareOutIcon as ArrowSquareOut,
  UserPlusIcon as UserPlus, UserIcon as User, PhoneIcon as Phone, CameraIcon as Camera,
  MagnifyingGlassIcon as MagnifyingGlass, GearSixIcon as GearSix, ChatCircleTextIcon as ChatCircleText,
  StarIcon as Star, StorefrontIcon as Storefront, ForkKnifeIcon as ForkKnife,
  SealCheckIcon as SealCheck, TrendUpIcon as TrendUp, EyeSlashIcon as EyeSlash,
  EyeIcon as Eye, BriefcaseIcon as Briefcase, CircleIcon as Circle,
  CodeIcon as Code, GlobeIcon as Globe,
  ImageIcon as ImageGlyph, ImagesIcon as Images,
} from '@phosphor-icons/react'

// ─────────────────────────────────────────────────────────────────────────
// Icon set — Phosphor, exposed under the app's existing (MUI) icon names.
//
// Why: the default @mui/icons-material set reads as generic/templated. Phosphor
// is friendlier and more distinctive, and its `duotone` weight (set globally in
// main.tsx via IconContext) echoes the ink+citrus two-tone brand.
//
// Every icon is wrapped so call sites don't change: Phosphor icons render at
// size="1em" with currentColor, so — like an MUI SvgIcon — they follow CSS
// font-size and color. `adapt()` adds MUI `sx` support plus the two MUI props
// still used in the codebase (`fontSize="small"` presets and palette `color=`),
// so the migration is import-swaps only.
// ─────────────────────────────────────────────────────────────────────────

const FONT_SIZE_PRESET: Record<string, number | string> = {
  small: 20, medium: 24, large: 35, inherit: 'inherit',
}
const PALETTE_COLORS = new Set([
  'primary', 'secondary', 'error', 'success', 'warning', 'info',
])

// Phosphor's own props (weight, mirrored, size, alt, onClick, data-*, …) minus
// `color` (we redefine it MUI-style), plus the MUI props still used at call sites.
type AppIconProps = Omit<IconProps, 'color' | 'ref'> & {
  sx?: SxProps<Theme>
  /** MUI-compatible: preset name, or a number/CSS length. */
  fontSize?: 'small' | 'medium' | 'large' | 'inherit' | number | string
  /** MUI-compatible palette name (primary, error, …) or any CSS colour. */
  color?: string
}

function adapt(Comp: PhosphorIcon) {
  // styled() gives `sx` support; the base font-size matches MUI's default
  // medium icon (1.5rem) so unsized icons don't shrink to the parent size.
  const Styled = styled(Comp)({
    fontSize: '1.5rem',
    verticalAlign: 'middle',
    flexShrink: 0,
  })

  return forwardRef<SVGSVGElement, AppIconProps>(function AppIcon(
    { sx, fontSize, color, ...rest }, ref,
  ) {
    const fs = typeof fontSize === 'string' && fontSize in FONT_SIZE_PRESET
      ? FONT_SIZE_PRESET[fontSize]
      : fontSize
    const colorValue = color != null
      ? (PALETTE_COLORS.has(color) ? `${color}.main` : color)
      : undefined

    // Compose as an sx array (never spread `sx` — it may be a function/array).
    const computed: SxProps<Theme> = {
      ...(fs != null ? { fontSize: fs } : null),
      ...(colorValue ? { color: colorValue } : null),
    }

    return (
      <Styled ref={ref} sx={[computed, ...(sx ? [sx] : [])] as SxProps<Theme>} {...rest} />
    )
  })
}

// ── MUI module name → Phosphor icon ─────────────────────────────────────────
export const AccessTime = adapt(Clock)
export const AccessTimeOutlined = adapt(Clock)
export const Add = adapt(Plus)
export const AdminPanelSettingsOutlined = adapt(ShieldCheck)
export const ArrowBackIosNew = adapt(CaretLeft)
export const ArrowForwardIos = adapt(CaretRight)
export const CalendarMonthOutlined = adapt(CalendarBlank)
export const CalendarToday = adapt(CalendarDots)
export const CancelOutlined = adapt(XCircle)
export const Check = adapt(CheckGlyph)
export const CheckCircleOutlined = adapt(CheckCircle)
export const ChevronRight = adapt(CaretRight)
export const Close = adapt(X)
export const CoffeeOutlined = adapt(Coffee)
export const ContentCopyOutlined = adapt(Copy)
export const CreditCardOutlined = adapt(CreditCard)
export const DashboardOutlined = adapt(SquaresFour)
export const DeleteOutlined = adapt(Trash)
export const DesignServicesOutlined = adapt(Sparkle)
export const DoNotDisturbAltOutlined = adapt(Prohibit)
export const EditOutlined = adapt(PencilSimple)
export const ErrorOutlineOutlined = adapt(WarningCircle)
export const ErrorOutlined = adapt(WarningCircle)
export const EventAvailableOutlined = adapt(CalendarCheck)
export const EventBusyOutlined = adapt(CalendarX)
export const EventNoteOutlined = adapt(CalendarDots)
export const EventSeatOutlined = adapt(Armchair)
export const ExpandMore = adapt(CaretDown)
export const GroupOutlined = adapt(UsersThree)
export const ImageOutlined = adapt(ImageGlyph)
export const CollectionsOutlined = adapt(Images)
export const HotelOutlined = adapt(Bed)
export const InsightsOutlined = adapt(ChartLineUp)
export const KeyboardArrowDown = adapt(CaretDown)
export const LoginOutlined = adapt(SignIn)
export const Logout = adapt(SignOut)
export const MailOutlined = adapt(Envelope)
export const Menu = adapt(ListIcon)
export const NotificationsOutlined = adapt(Bell)
export const OpenInNewOutlined = adapt(ArrowSquareOut)
export const Person2Outlined = adapt(User)
export const PersonAddAltOutlined = adapt(UserPlus)
export const PersonAddOutlined = adapt(UserPlus)
export const PhoneOutlined = adapt(Phone)
export const PhotoCameraOutlined = adapt(Camera)
export const ScheduleOutlined = adapt(Clock)
export const Search = adapt(MagnifyingGlass)
export const SearchOffOutlined = adapt(MagnifyingGlass)
export const SettingsOutlined = adapt(GearSix)
export const SmsOutlined = adapt(ChatCircleText)
export const RadioButtonUnchecked = adapt(Circle)
export const StarRounded = adapt(Star)
export const StorefrontOutlined = adapt(Storefront)
export const TableRestaurantOutlined = adapt(ForkKnife)
export const TaskAltOutlined = adapt(SealCheck)
export const Today = adapt(CalendarDots)
export const TrendingUp = adapt(TrendUp)
export const VisibilityOffOutlined = adapt(EyeSlash)
export const VisibilityOutlined = adapt(Eye)
export const WorkOutlineOutlined = adapt(Briefcase)
export const CodeOutlined = adapt(Code)
export const LanguageOutlined = adapt(Globe)
