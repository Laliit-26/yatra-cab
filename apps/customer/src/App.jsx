import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth, LoadingScreen } from '@yatracab/ui';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Book from './pages/Book.jsx';
import MyRides from './pages/MyRides.jsx';
import RideDetail from './pages/RideDetail.jsx';
import Profile from './pages/Profile.jsx';
import Sharing from './pages/Sharing.jsx';
import Rewards from './pages/Rewards.jsx';
import Track from './pages/Track.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen label="Starting YatraCab…" />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={loading ? <LoadingScreen /> : user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/track/:token" element={<Track />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/book" element={<Book />} />
        <Route path="/sharing" element={<Sharing />} />
        {/* old link, kept so existing bookmarks still land somewhere */}
        <Route path="/discover" element={<Navigate to="/sharing" replace />} />
        <Route path="/rewards" element={<Rewards />} />
        <Route path="/rides" element={<MyRides />} />
        <Route path="/rides/:id" element={<RideDetail />} />
        <Route path="/profile" element={<Profile />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
