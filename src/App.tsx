import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';

type UserRole = 'admin' | 'super_admin' | 'student' | 'teacher' | 'employee';
type UserStatus = 'pending' | 'approved' | 'canceled';

type Branch = {
  _id: string;
  code: string;
  name: { en: string; ar: string };
};

type UserLanguage = {
  language: string;
  level: string;
};

type User = {
  _id: string;
  arabicName: string;
  englishName: string;
  phone: string;
  role: UserRole;
  status: UserStatus;
  branchId: string | Branch;
  languages?: UserLanguage[];
  adminMessage?: string | null;
};

type ReportMap = Record<string, number>;
type JwtPayload = { sub: string; role: UserRole };

type ActiveUser = {
  _id: string;
  arabicName: string;
  englishName: string;
  phone: string;
  role: UserRole;
  branchId: string;
  lastScannedAt: string;
};

type ActiveUsersByRole = {
  teachers: ActiveUser[];
  students: ActiveUser[];
  employees: ActiveUser[];
};

const API_BASE_URL =
  process.env.REACT_APP_API_BASE_URL?.replace(/\/$/, '') ||
  'http://localhost:5000';

const statusTabs: UserStatus[] = ['pending', 'approved', 'canceled'];
const monthNames = [
  'يناير',
  'فبراير',
  'مارس',
  'ابريل',
  'مايو',
  'يونيو',
  'يوليو',
  'اغسطس',
  'سبتمبر',
  'اكتوبر',
  'نوفمبر',
  'ديسمبر',
];

const roleLabel: Record<UserRole, string> = {
  admin: 'ادمن',
  super_admin: 'سوبر ادمن',
  student: 'طالب',
  teacher: 'مدرس',
  employee: 'موظف',
};

const statusLabel: Record<UserStatus, string> = {
  pending: 'معلق',
  approved: 'مقبول',
  canceled: 'مرفوض',
};

const now = new Date();
const defaultYear = now.getFullYear();
const defaultMonth = now.getMonth() + 1;

const getBranchId = (user: User): string =>
  typeof user.branchId === 'string' ? user.branchId : user.branchId._id;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'حدث خطا غير متوقع';

const decodeJwtPayload = (token: string): JwtPayload => {
  const payloadPart = token.split('.')[1];
  const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(normalized)) as JwtPayload;
};

async function apiRequest<T>(
  path: string,
  options?: RequestInit,
  token?: string,
): Promise<T> {
  const headers = new Headers(options?.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}/${path.replace(/^\/+/, '')}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = `فشل الطلب (${response.status})`;
    try {
      const data = await response.json();
      if (typeof data?.message === 'string') message = data.message;
      if (Array.isArray(data?.message)) message = data.message.join(', ');
    } catch {
      // fallback message
    }
    throw new Error(message);
  }

  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

function BarChart({
  title,
  rows,
  unit,
}: {
  title: string;
  rows: { label: string; value: number }[];
  unit: string;
}) {
  const max = Math.max(...rows.map((item) => item.value), 0);

  return (
    <section className="panel">
      <h3>{title}</h3>
      {rows.length === 0 && <p className="empty">لا توجد بيانات لهذا الفلتر</p>}
      {rows.map((item) => {
        const width = max > 0 ? `${(item.value / max) * 100}%` : '0%';
        return (
          <div key={item.label} className="bar-row">
            <div className="bar-meta">
              <span>{item.label}</span>
              <strong>
                {item.value.toFixed(2)} {unit}
              </strong>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width }} />
            </div>
          </div>
        );
      })}
    </section>
  );
}

function App() {
  const [token, setToken] = useState<string>(
    () => localStorage.getItem('token') || '',
  );
  const [jwtPayload, setJwtPayload] = useState<JwtPayload | null>(() => {
    const stored = localStorage.getItem('token');
    if (!stored) return null;
    try {
      return decodeJwtPayload(stored);
    } catch {
      return null;
    }
  });

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeStatus, setActiveStatus] = useState<UserStatus>('pending');
  const [users, setUsers] = useState<User[]>([]);
  const [scopedUsers, setScopedUsers] = useState<User[]>([]);
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [analyticsBranchId, setAnalyticsBranchId] = useState('');
  const [analyticsRole, setAnalyticsRole] = useState('');
  const [activeNowBranchId, setActiveNowBranchId] = useState('');
  const [activeNowUsers, setActiveNowUsers] = useState<ActiveUsersByRole>({
    teachers: [],
    students: [],
    employees: [],
  });
  const [activeNowLoading, setActiveNowLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [year, setYear] = useState(defaultYear);
  const [month, setMonth] = useState(defaultMonth);
  const [sessionsMap, setSessionsMap] = useState<ReportMap>({});
  const [hoursMap, setHoursMap] = useState<ReportMap>({});
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const [updatingUserId, setUpdatingUserId] = useState('');
  const [savingMessageUserId, setSavingMessageUserId] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const role = currentUser?.role || jwtPayload?.role;

  const getScopedBranchId = useCallback((): string => {
    if (!currentUser) return selectedBranchId;
    if (currentUser.role === 'admin') return getBranchId(currentUser);
    return selectedBranchId;
  }, [currentUser, selectedBranchId]);

  const getAnalyticsBranchId = useCallback((): string => {
    if (!currentUser) return analyticsBranchId;
    if (currentUser.role === 'admin') return getBranchId(currentUser);
    return analyticsBranchId;
  }, [analyticsBranchId, currentUser]);

  const getActiveNowBranchId = useCallback((): string => {
    if (!currentUser) return activeNowBranchId;
    if (currentUser.role === 'admin') return getBranchId(currentUser);
    return activeNowBranchId;
  }, [activeNowBranchId, currentUser]);

  const branchNameById = useMemo(
    () =>
      branches.reduce<Record<string, string>>((acc, branch) => {
        acc[branch._id] = `${branch.name.ar} (${branch.code})`;
        return acc;
      }, {}),
    [branches],
  );

  const userNameById = useMemo(
    () =>
      scopedUsers.reduce<Record<string, string>>((acc, user) => {
        acc[user._id] = `${user.arabicName} / ${user.englishName}`;
        return acc;
      }, {}),
    [scopedUsers],
  );

  const loadUsersByStatus = useCallback(async () => {
    if (!token || !currentUser) return;
    const params = new URLSearchParams();
    params.set('status', activeStatus);
    const scopedBranch = getScopedBranchId();
    if (scopedBranch) params.set('branchId', scopedBranch);
    if (search.trim()) params.set('search', search.trim());

    const data = await apiRequest<User[]>(`users?${params.toString()}`, undefined, token);
    setUsers(data.filter((user) => user._id !== currentUser._id));
  }, [activeStatus, currentUser, getScopedBranchId, search, token]);

  const loadScopedUsers = useCallback(async () => {
    if (!token || !currentUser) return;
    const params = new URLSearchParams();
    const scopedBranch = getAnalyticsBranchId();
    if (scopedBranch) params.set('branchId', scopedBranch);
    if (analyticsRole) params.set('role', analyticsRole);

    const data = await apiRequest<User[]>(`users?${params.toString()}`, undefined, token);
    const filtered = data.filter((user) => user._id !== currentUser._id);
    setScopedUsers(filtered);
  }, [analyticsRole, currentUser, getAnalyticsBranchId, token]);

  useEffect(() => {
    if (!token || !jwtPayload?.sub) return;

    setIsLoading(true);
    setPageError('');
    Promise.all([
      apiRequest<User>(`users/${jwtPayload.sub}`, undefined, token),
      apiRequest<Branch[]>('branches', undefined, token),
    ])
      .then(([me, branchList]) => {
        setCurrentUser(me);
        setBranches(branchList);
        if (me.role === 'admin') {
          const myBranchId = getBranchId(me);
          setSelectedBranchId(myBranchId);
          setAnalyticsBranchId(myBranchId);
          setActiveNowBranchId(myBranchId);
        } else {
          setSelectedBranchId('');
          setAnalyticsBranchId('');
          setActiveNowBranchId('');
        }
      })
      .catch((error) => {
        setPageError(getErrorMessage(error));
        localStorage.removeItem('token');
        setToken('');
        setJwtPayload(null);
      })
      .finally(() => setIsLoading(false));
  }, [jwtPayload?.sub, token]);

  useEffect(() => {
    loadUsersByStatus().catch((error) => setPageError(getErrorMessage(error)));
  }, [loadUsersByStatus]);

  useEffect(() => {
    loadScopedUsers().catch((error) => setPageError(getErrorMessage(error)));
  }, [loadScopedUsers]);

  useEffect(() => {
    setMessageDrafts((previous) => {
      const next = { ...previous };
      users.forEach((user) => {
        if (!(user._id in next)) {
          next[user._id] = user.adminMessage || '';
        }
      });
      return next;
    });
  }, [users]);

  useEffect(() => {
    if (!selectedUserId) return;
    if (!scopedUsers.some((user) => user._id === selectedUserId)) {
      setSelectedUserId('');
    }
  }, [scopedUsers, selectedUserId]);

  useEffect(() => {
    if (!token || !currentUser) return;

    const params = new URLSearchParams();
    const scopedBranch = getActiveNowBranchId();
    if (scopedBranch) params.set('branchId', scopedBranch);

    setActiveNowLoading(true);
    apiRequest<ActiveUsersByRole>(`reports/active-now?${params.toString()}`, undefined, token)
      .then((data) => {
        const excludeMe = (items: ActiveUser[]) =>
          items.filter((item) => item._id !== currentUser._id);

        setActiveNowUsers({
          teachers: excludeMe(data.teachers || []),
          students: excludeMe(data.students || []),
          employees: excludeMe(data.employees || []),
        });
      })
      .catch((error) => setPageError(getErrorMessage(error)))
      .finally(() => setActiveNowLoading(false));
  }, [currentUser, getActiveNowBranchId, token]);

  useEffect(() => {
    if (!token) return;
    if (scopedUsers.length === 0) {
      setSessionsMap({});
      setHoursMap({});
      return;
    }

    const params = new URLSearchParams({
      year: String(year),
      month: String(month),
    });

    setAnalyticsLoading(true);
    Promise.all(
      scopedUsers.map(async (user) => {
        const [sessionsData, durationData] = await Promise.all([
          apiRequest<{ totalSessions: number }>(
            `reports/monthly/${user._id}?${params.toString()}`,
            undefined,
            token,
          ),
          apiRequest<{ totalHours: number }>(
            `reports/monthly-duration/${user._id}?${params.toString()}`,
            undefined,
            token,
          ),
        ]);
        return {
          userId: user._id,
          sessions: sessionsData.totalSessions,
          hours: durationData.totalHours,
        };
      }),
    )
      .then((data) => {
        const nextSessions: ReportMap = {};
        const nextHours: ReportMap = {};

        data.forEach((item) => {
          nextSessions[item.userId] = item.sessions;
          nextHours[item.userId] = item.hours;
        });

        setSessionsMap(nextSessions);
        setHoursMap(nextHours);
      })
      .catch((error) => setPageError(getErrorMessage(error)))
      .finally(() => setAnalyticsLoading(false));
  }, [month, scopedUsers, token, year]);

  const sessionsRows = useMemo(
    () =>
      Object.entries(sessionsMap)
        .map(([userId, value]) => ({ label: userNameById[userId] || userId, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
    [sessionsMap, userNameById],
  );

  const hoursRows = useMemo(
    () =>
      Object.entries(hoursMap)
        .map(([userId, value]) => ({ label: userNameById[userId] || userId, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10),
    [hoursMap, userNameById],
  );

  const statusRows = useMemo(() => {
    const counts: Record<UserStatus, number> = {
      pending: 0,
      approved: 0,
      canceled: 0,
    };
    scopedUsers.forEach((user) => {
      counts[user.status] += 1;
    });
    return statusTabs.map((status) => ({ label: statusLabel[status], value: counts[status] }));
  }, [scopedUsers]);

  const roleRows = useMemo(() => {
    const counts: Record<UserRole, number> = {
      admin: 0,
      super_admin: 0,
      student: 0,
      teacher: 0,
      employee: 0,
    };
    scopedUsers.forEach((user) => {
      counts[user.role] += 1;
    });
    return (Object.keys(counts) as UserRole[])
      .map((item) => ({ label: roleLabel[item], value: counts[item] }))
      .filter((item) => item.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [scopedUsers]);

  const sessionsByBranchRows = useMemo(() => {
    const aggregate: Record<string, number> = {};
    scopedUsers.forEach((user) => {
      const branchId = getBranchId(user);
      aggregate[branchId] = (aggregate[branchId] || 0) + (sessionsMap[user._id] || 0);
    });
    return Object.entries(aggregate)
      .map(([branchId, value]) => ({
        label: branchNameById[branchId] || branchId,
        value,
      }))
      .sort((a, b) => b.value - a.value);
  }, [branchNameById, scopedUsers, sessionsMap]);

  const hoursByBranchRows = useMemo(() => {
    const aggregate: Record<string, number> = {};
    scopedUsers.forEach((user) => {
      const branchId = getBranchId(user);
      aggregate[branchId] = (aggregate[branchId] || 0) + (hoursMap[user._id] || 0);
    });
    return Object.entries(aggregate)
      .map(([branchId, value]) => ({
        label: branchNameById[branchId] || branchId,
        value,
      }))
      .sort((a, b) => b.value - a.value);
  }, [branchNameById, hoursMap, scopedUsers]);

  const totalSessions = Object.values(sessionsMap).reduce((sum, value) => sum + value, 0);
  const totalHours = Object.values(hoursMap).reduce((sum, value) => sum + value, 0);
  const selectedUserSessions = selectedUserId ? sessionsMap[selectedUserId] ?? 0 : null;
  const selectedUserHours = selectedUserId ? hoursMap[selectedUserId] ?? 0 : null;

  const logout = () => {
    localStorage.removeItem('token');
    setToken('');
    setJwtPayload(null);
    setCurrentUser(null);
    setSelectedUserId('');
    setPageError('');
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError('');
    setIsLoggingIn(true);

    try {
      const data = await apiRequest<{ access_token: string }>('auth/admin/login', {
        method: 'POST',
        body: JSON.stringify({ phone, password }),
      });
      localStorage.setItem('token', data.access_token);
      setToken(data.access_token);
      setJwtPayload(decodeJwtPayload(data.access_token));
      setPhone('');
      setPassword('');
    } catch (error) {
      setAuthError(getErrorMessage(error));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleStatusChange = async (userId: string, status: UserStatus) => {
    if (!token) return;
    setUpdatingUserId(userId);
    setPageError('');

    try {
      if (status === 'approved') {
        await apiRequest(`registration/${userId}/approve`, { method: 'POST' }, token);
      } else if (status === 'canceled') {
        await apiRequest(`registration/${userId}/reject`, { method: 'POST' }, token);
      } else {
        await apiRequest(
          `users/${userId}/status`,
          { method: 'PATCH', body: JSON.stringify({ status }) },
          token,
        );
      }

      await Promise.all([loadUsersByStatus(), loadScopedUsers()]);
    } catch (error) {
      setPageError(getErrorMessage(error));
    } finally {
      setUpdatingUserId('');
    }
  };

  const handleMessageSave = async (userId: string, overrideMessage?: string) => {
    if (!token) return;
    setSavingMessageUserId(userId);
    setPageError('');

    try {
      await apiRequest(
        `users/${userId}/admin-message`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            adminMessage:
              overrideMessage !== undefined
                ? overrideMessage
                : messageDrafts[userId] || '',
          }),
        },
        token,
      );
      await Promise.all([loadUsersByStatus(), loadScopedUsers()]);
    } catch (error) {
      setPageError(getErrorMessage(error));
    } finally {
      setSavingMessageUserId('');
    }
  };

  const formatActiveTime = (value: string) =>
    new Date(value).toLocaleTimeString('ar-EG', {
      hour: '2-digit',
      minute: '2-digit',
    });

  if (!token || !jwtPayload) {
    return (
      <main className="login-layout">
        <form className="login-card" onSubmit={handleLogin}>
          <h1>نظام ادارة المعهد</h1>
          <p>تسجيل دخول الادمن</p>

          <label>
            الهاتف
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="ادخل البيانات"
              required
            />
          </label>

          <label>
            كلمة المرور
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {authError && <p className="error">{authError}</p>}
          <button type="submit" disabled={isLoggingIn}>
            {isLoggingIn ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="crm-layout">
      <header className="topbar">
        <div>
          <h1>لوحة ادارة المعهد</h1>
          <p>
            الصلاحية: <strong>{role ? roleLabel[role] : '-'}</strong>
            {currentUser && role !== 'super_admin' && (
              <>
                {' | '}
                الفرع: <strong>{branchNameById[getBranchId(currentUser)] || getBranchId(currentUser)}</strong>
              </>
            )}
          </p>
        </div>
        <button className="ghost" onClick={logout}>
          تسجيل الخروج
        </button>
      </header>

      {isLoading && <p className="loading">جاري تحميل بيانات المستخدم...</p>}
      {pageError && <p className="error">{pageError}</p>}

      <section className="panel">
        <div className="panel-head">
          <h2>المستخدمون</h2>
          <div className="filters">
            {role === 'super_admin' && (
              <select value={selectedBranchId} onChange={(event) => setSelectedBranchId(event.target.value)}>
                <option value="">كل الفروع</option>
                {branches.map((branch) => (
                  <option key={branch._id} value={branch._id}>
                    {branch.name.ar} ({branch.code})
                  </option>
                ))}
              </select>
            )}
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث بالاسم او الهاتف"
            />
          </div>
        </div>

        <div className="tabs">
          {statusTabs.map((status) => (
            <button
              key={status}
              className={status === activeStatus ? 'active' : ''}
              onClick={() => setActiveStatus(status)}
            >
              {statusLabel[status]}
            </button>
          ))}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الهاتف</th>
                <th>الدور</th>
                <th>الفرع</th>
                <th>اللغات والمستويات</th>
                <th>الحالة</th>
                <th>تغيير الحالة</th>
                <th>رسالة ادارية</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const branchId = getBranchId(user);
                return (
                  <tr key={user._id}>
                    <td>{user.arabicName || user.englishName}</td>
                    <td>{user.phone}</td>
                    <td>{roleLabel[user.role]}</td>
                    <td>{branchNameById[branchId] || branchId}</td>
                    <td>
                      {(user.languages || []).length > 0
                        ? (user.languages || [])
                            .map((item) => `${item.language} (${item.level})`)
                            .join(' - ')
                        : '-'}
                    </td>
                    <td>{statusLabel[user.status]}</td>
                    <td>
                      <select
                        value={user.status}
                        onChange={(event) => handleStatusChange(user._id, event.target.value as UserStatus)}
                        disabled={updatingUserId === user._id}
                      >
                        {statusTabs.map((status) => (
                          <option key={status} value={status}>
                            {statusLabel[status]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="message-actions">
                        <input
                          value={messageDrafts[user._id] ?? user.adminMessage ?? ''}
                          onChange={(event) =>
                            setMessageDrafts((previous) => ({
                              ...previous,
                              [user._id]: event.target.value,
                            }))
                          }
                          placeholder="اكتب رسالة للمستخدم"
                        />
                        <button
                          type="button"
                          onClick={() => handleMessageSave(user._id)}
                          disabled={savingMessageUserId === user._id}
                        >
                          حفظ
                        </button>
                        <button
                          type="button"
                          className="ghost danger"
                          onClick={() => {
                            setMessageDrafts((previous) => ({
                              ...previous,
                              [user._id]: '',
                            }));
                            handleMessageSave(user._id, '');
                          }}
                          disabled={savingMessageUserId === user._id}
                        >
                          حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={8} className="empty-cell">
                    لا يوجد مستخدمون في هذا التبويب
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>المستخدمون المتواجدون الان</h2>
          <div className="filters">
            {role === 'super_admin' && (
              <select
                value={activeNowBranchId}
                onChange={(event) => setActiveNowBranchId(event.target.value)}
              >
                <option value="">كل الفروع</option>
                {branches.map((branch) => (
                  <option key={branch._id} value={branch._id}>
                    {branch.name.ar} ({branch.code})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {activeNowLoading && <p className="loading">جاري تحميل المستخدمين المتواجدين...</p>}

        <div className="active-now-grid">
          <article className="active-now-column employees-col">
            <h3>الموظفون</h3>
            {activeNowUsers.employees.length === 0 && <p className="empty">لا يوجد حاليا</p>}
            {activeNowUsers.employees.map((user) => (
              <div className="active-user-card" key={user._id}>
                <strong>{user.arabicName || user.englishName}</strong>
                <span>{user.phone}</span>
                <small>اخر دخول: {formatActiveTime(user.lastScannedAt)}</small>
              </div>
            ))}
          </article>

          <article className="active-now-column students-col">
            <h3>الطلاب</h3>
            {activeNowUsers.students.length === 0 && <p className="empty">لا يوجد حاليا</p>}
            {activeNowUsers.students.map((user) => (
              <div className="active-user-card" key={user._id}>
                <strong>{user.arabicName || user.englishName}</strong>
                <span>{user.phone}</span>
                <small>اخر دخول: {formatActiveTime(user.lastScannedAt)}</small>
              </div>
            ))}
          </article>

          <article className="active-now-column teachers-col">
            <h3>المدرسون</h3>
            {activeNowUsers.teachers.length === 0 && <p className="empty">لا يوجد حاليا</p>}
            {activeNowUsers.teachers.map((user) => (
              <div className="active-user-card" key={user._id}>
                <strong>{user.arabicName || user.englishName}</strong>
                <span>{user.phone}</span>
                <small>اخر دخول: {formatActiveTime(user.lastScannedAt)}</small>
              </div>
            ))}
          </article>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>تحليلات الحضور</h2>
          <div className="filters">
            {role === 'super_admin' && (
              <select
                value={analyticsBranchId}
                onChange={(event) => setAnalyticsBranchId(event.target.value)}
              >
                <option value="">كل الفروع</option>
                {branches.map((branch) => (
                  <option key={branch._id} value={branch._id}>
                    {branch.name.ar} ({branch.code})
                  </option>
                ))}
              </select>
            )}
            <select
              value={analyticsRole}
              onChange={(event) => setAnalyticsRole(event.target.value)}
            >
              <option value="">كل الادوار</option>
              <option value="student">{roleLabel.student}</option>
              <option value="teacher">{roleLabel.teacher}</option>
              <option value="employee">{roleLabel.employee}</option>
              <option value="admin">{roleLabel.admin}</option>
              <option value="super_admin">{roleLabel.super_admin}</option>
            </select>
            <input
              type="number"
              min={2020}
              max={2100}
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
            />
            <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
              {monthNames.map((name, index) => (
                <option key={name} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
            <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
              <option value="">كل المستخدمين</option>
              {scopedUsers.map((user) => (
                <option key={user._id} value={user._id}>
                  {(user.arabicName || user.englishName) + ' - ' + user.phone}
                </option>
              ))}
            </select>
          </div>
        </div>

        {analyticsLoading && <p className="loading">جاري تحميل التقارير...</p>}

        <div className="kpis">
          <article>
            <h4>عدد المستخدمين</h4>
            <p>{scopedUsers.length}</p>
          </article>
          <article>
            <h4>اجمالي الجلسات</h4>
            <p>{totalSessions}</p>
          </article>
          <article>
            <h4>اجمالي الساعات</h4>
            <p>{totalHours.toFixed(2)}</p>
          </article>
          <article>
            <h4>المستخدم المختار</h4>
            <p>
              {selectedUserId
                ? `${selectedUserSessions ?? 0} جلسة / ${(selectedUserHours ?? 0).toFixed(2)} ساعة`
                : 'اختر مستخدما'}
            </p>
          </article>
        </div>
      </section>

      <div className="charts-grid">
        <BarChart title="اعلى المستخدمين في الجلسات" rows={sessionsRows} unit="جلسة" />
        <BarChart title="اعلى المستخدمين في الساعات" rows={hoursRows} unit="ساعة" />
        <BarChart title="توزيع المستخدمين حسب الحالة" rows={statusRows} unit="مستخدم" />
        <BarChart title="توزيع المستخدمين حسب الدور" rows={roleRows} unit="مستخدم" />
        <BarChart title="اجمالي الجلسات حسب الفرع" rows={sessionsByBranchRows} unit="جلسة" />
        <BarChart title="اجمالي الساعات حسب الفرع" rows={hoursByBranchRows} unit="ساعة" />
      </div>
    </main>
  );
}

export default App;
