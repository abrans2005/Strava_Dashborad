/* main.js — 顶栏同步与页面启动（由 templates/dashboard.html 拆分） */

function formatSyncTime(iso) {
            if (!iso) return '数据未同步';
            const date = new Date(iso);
            if (Number.isNaN(date.getTime())) return '数据未同步';
            const now = new Date();
            const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            if (date.toDateString() === now.toDateString()) return `最后同步 今天 ${time}`;
            return `最后同步 ${date.getMonth() + 1}-${date.getDate()} ${time}`;
        }

        function applySyncStatus(status) {
            const timeEl = document.getElementById('header-sync-time');
            if (timeEl) timeEl.textContent = formatSyncTime(status && status.last_sync_time);

            const subEl = document.getElementById('header-athlete-sub');
            if (subEl && status && typeof status.activity_count === 'number') {
                subEl.textContent = status.activity_count > 0
                    ? `共 ${status.activity_count} 条活动`
                    : '还没有活动数据';
            }
        }

        async function loadHeaderProfile() {
            const nameEl = document.getElementById('header-athlete-name');
            const avatarEl = document.getElementById('header-avatar');
            const subEl = document.getElementById('header-athlete-sub');

            try {
                const [athleteRes, statusRes] = await Promise.all([
                    fetch('/athlete'),
                    fetch('/sync-status')
                ]);

                if (athleteRes.ok) {
                    const athlete = await athleteRes.json();
                    const name = [athlete.firstname, athlete.lastname].filter(Boolean).join(' ')
                        || athlete.username || '已连接';
                    if (nameEl) nameEl.textContent = name;

                    const avatarUrl = athlete.profile_medium || athlete.profile;
                    if (avatarEl && avatarUrl) {
                        avatarEl.style.backgroundImage = `url("${avatarUrl}")`;
                        avatarEl.textContent = '';
                    } else if (avatarEl) {
                        avatarEl.textContent = name.slice(0, 1).toUpperCase();
                    }
                } else {
                    if (nameEl) nameEl.textContent = '未连接';
                    if (subEl) subEl.textContent = '请先在登录页完成授权';
                }

                if (statusRes.ok) applySyncStatus(await statusRes.json());
            } catch (err) {
                if (subEl) subEl.textContent = '同步状态读取失败';
                console.error('加载顶栏信息失败:', err);
            }
        }

        let headerSyncing = false;

        async function syncNow() {
            if (headerSyncing) return;
            headerSyncing = true;

            const btn = document.getElementById('header-sync-btn');
            const label = document.getElementById('header-sync-label');
            if (btn) {
                btn.disabled = true;
                btn.classList.add('syncing');
            }
            if (label) label.textContent = '同步中…';
            startPageProgress();

            try {
                activitiesLoaded = false;
                await ensureActivitiesSynced(true);

                const statusRes = await fetch('/sync-status');
                if (statusRes.ok) applySyncStatus(await statusRes.json());

                if (typeof currentPageReload === 'function') await currentPageReload();
            } catch (err) {
                const timeEl = document.getElementById('header-sync-time');
                if (timeEl) timeEl.textContent = '同步失败：' + err.message;
            } finally {
                headerSyncing = false;
                stopPageProgress();
                if (btn) {
                    btn.disabled = false;
                    btn.classList.remove('syncing');
                }
                if (label) label.textContent = '立即同步';
            }
        }

        // ---------- 侧边菜单折叠（收起为图标栏，状态持久化） ----------
        const SIDEBAR_COLLAPSED_KEY = 'sidebar-collapsed';

        function applySidebarState(collapsed) {
            document.querySelector('.body')?.classList.toggle('sidebar-collapsed', collapsed);
            const btn = document.getElementById('menu-toggle');
            if (btn) {
                btn.textContent = collapsed ? '›' : '‹';
                btn.title = collapsed ? '展开菜单' : '收起菜单';
            }
        }

        function toggleSidebar() {
            const bodyEl = document.querySelector('.body');
            const collapsed = !bodyEl.classList.contains('sidebar-collapsed');
            try {
                localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
            } catch (e) { /* 隐私模式下忽略 */ }
            applySidebarState(collapsed);
        }

        // 页面加载后按当前 hash 打开对应页面（无 hash 默认图表分析）
        document.addEventListener('DOMContentLoaded', () => {
            let savedCollapsed = false;
            try {
                savedCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
            } catch (e) { /* 隐私模式下忽略 */ }
            applySidebarState(savedCollapsed);
            initGlobalFilterBar();
            loadHeaderProfile();
            if (!location.hash) history.replaceState(null, '', '#/chart');
            dispatchRoute();
        });
