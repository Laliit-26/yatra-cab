// @yatracab/ui — shared design system barrel.
export { cn } from './lib/cn.js';
export * from './lib/format.js';
export { createApi, AuthProvider, useAuth } from './lib/api.jsx';

export { Button, IconButton } from './components/Button.jsx';
export { Card, CardHeader, CardBody } from './components/Card.jsx';
export { Field, Label, Input, Textarea, Select } from './components/Field.jsx';
export { Badge, StatusBadge } from './components/Badge.jsx';
export { Spinner, LoadingScreen, Skeleton, EmptyState, ErrorState, QueryBoundary } from './components/Feedback.jsx';
export { StatCard } from './components/StatCard.jsx';
export { Table } from './components/Table.jsx';
export { Modal } from './components/Modal.jsx';
export { Avatar, StarRating, StarPicker, PageHeader, Segmented, Logo } from './components/Misc.jsx';
export { AuthScreen } from './components/AuthScreen.jsx';
export { LocationInput } from './components/LocationInput.jsx';
export { VehicleIcon, VEHICLE_META } from './components/VehicleIcon.jsx';
export { carMarkerHtml, facesLeft, CAR_ASPECT } from './components/carMarker.js';
export { LanguageSwitcher } from './components/LanguageSwitcher.jsx';

// i18n — namespaced messages, same authoring shape as the Affiliates frontend.
export { I18nProvider, useTranslations, useLocale } from './i18n/I18nProvider.jsx';
export { LOCALES, DEFAULT_LOCALE, detectLocale } from './i18n/config.js';

// Re-export toast so apps import from one place.
export { default as toast, Toaster } from 'react-hot-toast';
