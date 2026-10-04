import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth, LoadingScreen } from '@yatracab/ui';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Live from './pages/Live.jsx';
import Coupons from './pages/Coupons.jsx';
import Verification from './pages/Verification.jsx';
import Drivers from './pages/Drivers.jsx';
import Customers from './pages/Customers.jsx';
import Bookings from './pages/Bookings.jsx';
import RoutesPage from './pages/Routes.jsx';
import Reports from './pages/Reports.jsx';
import Safety from './pages/Safety.jsx';
import Finance from './pages/Finance.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen label="Starting YatraCab Ops…" />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={loading ? <LoadingScreen /> : user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/live" element={<Live />} />
        <Route path="/coupons" element={<Coupons />} />
        <Route path="/verification" element={<Verification />} />
        <Route path="/drivers" element={<Drivers />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/bookings" element={<Bookings />} />
        <Route path="/routes" element={<RoutesPage />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/safety" element={<Safety />} />
        <Route path="/finance" element={<Finance />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
