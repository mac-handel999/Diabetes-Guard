/* ═══════════════════════════════════════════════════════════════
   Dia Shield — Podium component
   New file. Vanilla JS, no dependencies.

   Usage:
     DiaPodium.render('#leaderboardPodium', participants);

   participants: array of objects (already sorted or unsorted).
   Supported fields per participant:
     alias | anon_handle | anonHandle
     full_name | fullName | name
     avatar | avatar_url | photo | image
     total_points | points
     badges: string[]
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
    'use strict';

    var STANDARD_BADGES = {
        first_log: ['🌱', 'First Healthy Log'],
        hydration: ['💧', 'Hydration Hero'],
        active: ['🏃', 'Active Achiever'],
        streak3: ['🔥', '3-Day Streak'],
        streak7: ['⚡', '7-Day Streak'],
        quiz_ace: ['🧠', 'Quiz Ace'],
        challenge: ['🎖️', 'Challenge Champion'],
        week1: ['🛡️', 'Week One Complete'],
        complete: ['🎓', 'Programme Complete']
    };

    var DAILY_BADGE_RE = /^daily_w(\d+)_d(\d+)$/;
    var WEEKLY_BADGE_RE = /^weekly_w(\d+)$/;

    // ── Helpers ────────────────────────────────────────────────
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function toText(value) {
        return value == null ? '' : String(value).trim();
    }

    function firstText() {
        for (var i = 0; i < arguments.length; i += 1) {
            var text = toText(arguments[i]);
            if (text) return text;
        }
        return '';
    }

    function toPoints(value) {
        var number = Number(value);
        return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
    }

    function formatPoints(points) {
        try {
            return toPoints(points).toLocaleString('en-US');
        } catch (err) {
            return String(toPoints(points));
        }
    }

    function normalizeBadges(value) {
        if (!Array.isArray(value)) return [];
        return value
            .map(function (badge) { return toText(badge); })
            .filter(function (badge, index, list) {
                return badge && list.indexOf(badge) === index;
            });
    }

    function safeImageUrl(value) {
        var url = toText(value);
        if (!url || /^\s*javascript:/i.test(url)) return '';
        if (/^(https?:\/\/|data:image\/|\/|\.{1,2}\/|Images\/)/i.test(url)) return url;
        return '';
    }

    function initialsFor(participant) {
        var source = participant.fullName || participant.alias || '';
        var words = source.split(/[\s_.-]+/).filter(Boolean);
        if (!words.length) return '?';
        if (words.length === 1) return words[0].charAt(0).toUpperCase();
        return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
    }

    function badgePresentation(badge) {
        var key = String(badge);
        var daily = key.match(DAILY_BADGE_RE);
        if (daily) {
            return {
                emoji: '🎯',
                label: 'Daily Champion, Week ' + daily[1] + ', Day ' + daily[2]
            };
        }

        var weekly = key.match(WEEKLY_BADGE_RE);
        if (weekly) {
            return { emoji: '🏆', label: 'Weekly Champion, Week ' + weekly[1] };
        }

        if (STANDARD_BADGES[key]) {
            return { emoji: STANDARD_BADGES[key][0], label: STANDARD_BADGES[key][1] };
        }

        return {
            emoji: '🏅',
            label: key.replace(/_/g, ' ') || 'Badge'
        };
    }

    function normalizeParticipant(raw) {
        var participant = raw && typeof raw === 'object' ? raw : {};

        var alias = firstText(participant.alias, participant.anon_handle, participant.anonHandle)
            .replace(/^@+/, '')
            .trim();

        var fullName = firstText(
            participant.full_name,
            participant.fullName,
            participant.name,
            participant.display_name
        );

        var points = toPoints(
            participant.total_points != null ? participant.total_points : participant.points
        );

        return {
            alias: alias,
            fullName: fullName,
            points: points,
            badges: normalizeBadges(participant.badges),
            avatar: safeImageUrl(
                participant.avatar || participant.avatar_url || participant.photo || participant.image
            )
        };
    }

    function sortByPoints(participants) {
        var list = Array.isArray(participants) ? participants.slice(0) : [];

        list.sort(function (a, b) {
            var aPoints = toPoints(a && (a.total_points != null ? a.total_points : a.points));
            var bPoints = toPoints(b && (b.total_points != null ? b.total_points : b.points));
            return bPoints - aPoints;
        });

        return list;
    }

    // ── Markup builders ────────────────────────────────────────
    function crownMarkup() {
        return '' +
            '<svg class="dia-podium__crown" viewBox="0 0 64 44" role="img" ' +
                 'aria-label="Winner crown" focusable="false">' +
                '<path d="M6 34 L10 10 L24 22 L32 4 L40 22 L54 10 L58 34 Z" ' +
                      'fill="#f5c842" stroke="#c9971b" stroke-width="2.5" ' +
                      'stroke-linejoin="round"></path>' +
                '<rect x="5" y="33" width="54" height="8" rx="4" ' +
                      'fill="#f5c842" stroke="#c9971b" stroke-width="2.5"></rect>' +
                '<circle cx="32" cy="10" r="3" fill="#ef6f6c"></circle>' +
                '<circle cx="14" cy="26" r="2.5" fill="#0f766e"></circle>' +
                '<circle cx="50" cy="26" r="2.5" fill="#0f766e"></circle>' +
            '</svg>';
    }

    function avatarMarkup(participant, rank) {
        var label = participant.fullName
            ? 'Avatar for ' + participant.fullName
            : 'Avatar for rank ' + rank + ' participant';

        var image = participant.avatar
            ? '<img src="' + escapeHtml(participant.avatar) + '" alt="" ' +
              'loading="lazy" data-dia-avatar-img>'
            : '';

        return '' +
            '<div class="dia-podium__avatar" role="img" aria-label="' +
                escapeHtml(label) + '">' +
                '<span class="dia-podium__initials" aria-hidden="true">' +
                    escapeHtml(initialsFor(participant)) +
                '</span>' +
                image +
            '</div>';
    }

    function badgeMarkup(badges) {
        if (!badges.length) return '';

        var visible = badges.slice(0, 3);
        var extraCount = badges.length - visible.length;

        var chips = visible.map(function (badge) {
            var presentation = badgePresentation(badge);
            return '' +
                '<span class="dia-podium__badge" role="img" ' +
                      'aria-label="Badge: ' + escapeHtml(presentation.label) + '" ' +
                      'title="' + escapeHtml(presentation.label) + '">' +
                    '<span aria-hidden="true">' + presentation.emoji + '</span>' +
                '</span>';
        }).join('');

        if (extraCount > 0) {
            chips += '' +
                '<span class="dia-podium__badge dia-podium__badge--more" role="img" ' +
                      'aria-label="' + extraCount + ' more badge' +
                      (extraCount === 1 ? '' : 's') + '">+' + extraCount + '</span>';
        }

        return '<div class="dia-podium__badges">' + chips + '</div>';
    }

    var SPARKLES = [
        { x: -38, y: -22, delay: 0 },
        { x: 30, y: -30, delay: 60 },
        { x: -46, y: 4, delay: 120 },
        { x: 44, y: -2, delay: 180 },
        { x: -16, y: -46, delay: 90 },
        { x: 18, y: -44, delay: 30 },
        { x: 2, y: -18, delay: 150 },
        { x: -30, y: -40, delay: 210 },
        { x: 36, y: -38, delay: 240 },
        { x: 10, y: -54, delay: 270 }
    ];

    function prefersReducedMotion() {
        return !!(global.matchMedia &&
            global.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function sparklesMarkup() {
        var dots = SPARKLES.map(function (sparkle) {
            return '<span class="dia-podium__sparkle" style="' +
                '--sx:' + sparkle.x + 'px;--sy:' + sparkle.y + 'px;--sd:' + sparkle.delay + 'ms"></span>';
        }).join('');

        return '<span class="dia-podium__sparkles" aria-hidden="true">' + dots + '</span>';
    }

    function animatePoints(container) {
        var nodes = container.querySelectorAll('[data-dia-points]');
        if (!nodes || !nodes.length || typeof global.requestAnimationFrame !== 'function') return;

        Array.prototype.forEach.call(nodes, function (node) {
            var target = Number(node.getAttribute('data-dia-points')) || 0;
            var delay = Number(node.getAttribute('data-dia-points-delay')) || 0;
            var textNode = node.firstChild;
            if (!target || !textNode || textNode.nodeType !== 3) return;

            var startTime = null;
            var duration = 720;

            function frame(now) {
                if (startTime === null) startTime = now;
                var elapsed = now - startTime - delay;

                if (elapsed < 0) {
                    global.requestAnimationFrame(frame);
                    return;
                }

                var progress = Math.min(1, elapsed / duration);
                var eased = 1 - Math.pow(1 - progress, 3);
                textNode.nodeValue = formatPoints(Math.round(target * eased));

                if (progress < 1) {
                    global.requestAnimationFrame(frame);
                } else {
                    textNode.nodeValue = formatPoints(target);
                }
            }

            global.requestAnimationFrame(frame);
        });
    }

    function identityMarkup(participant, rank, animate) {
        var aliasText = participant.alias ? '@' + participant.alias : 'Participant';
        var showFullName = participant.fullName &&
            participant.fullName.toLowerCase() !== participant.alias.toLowerCase();
        var finalPoints = formatPoints(participant.points);
        var pointsDelay = rank === 1 ? 380 : rank === 2 ? 290 : 200;
        var pointsAttrs = animate && participant.points
            ? ' data-dia-points="' + participant.points +
              '" data-dia-points-delay="' + pointsDelay + '"'
            : '';

        return '' +
            '<span class="dia-podium__alias">' + escapeHtml(aliasText) + '</span>' +
            (showFullName
                ? '<span class="dia-podium__name">' + escapeHtml(participant.fullName) + '</span>'
                : '') +
            '<span class="dia-podium__points" aria-label="' +
                escapeHtml(finalPoints + ' points') + '"' + pointsAttrs + '>' +
                escapeHtml(animate ? '0' : finalPoints) +
                '<span class="dia-podium__points-label" aria-hidden="true"> pts</span>' +
            '</span>' +
            badgeMarkup(participant.badges);
    }

    function waitingMarkup() {
        return '' +
            '<div class="dia-podium__figure">' +
                '<div class="dia-podium__avatar" role="img" ' +
                     'aria-label="Open leaderboard spot">' +
                    '<span class="dia-podium__initials" aria-hidden="true">?</span>' +
                '</div>' +
                '<span class="dia-podium__empty-label">Waiting for challengers</span>' +
            '</div>';
    }

    function placeMarkup(participant, rank, animate) {
        var isEmpty = !participant;
        var classes = 'dia-podium__place dia-podium__place--' + rank +
            (isEmpty ? ' dia-podium__place--empty' : '');

        var figure = isEmpty
            ? waitingMarkup()
            : '<div class="dia-podium__figure">' +
                  (rank === 1 ? crownMarkup() : '') +
                  avatarMarkup(participant, rank) +
                  identityMarkup(participant, rank, animate) +
                  (animate && rank === 1 ? sparklesMarkup() : '') +
              '</div>';

        return '' +
            '<li class="' + classes + '">' +
                '<span class="dia-sr-only">Rank ' + rank + '</span>' +
                figure +
                '<div class="dia-podium__block" aria-hidden="true">' +
                    '<span class="dia-podium__rank">' + rank + '</span>' +
                '</div>' +
            '</li>';
    }

    // ── Public render ──────────────────────────────────────────
    function resolveContainer(target) {
        if (typeof target === 'string') return document.querySelector(target);
        return target || null;
    }

    function render(target, participants, options) {
        var container = resolveContainer(target);
        if (!container) {
            if (global.console && global.console.warn) {
                global.console.warn('[DiaPodium] Container not found:', target);
            }
            return null;
        }

        var opts = options || {};
        var animate = !!opts.animate && !prefersReducedMotion();

        var top = sortByPoints(participants)
            .slice(0, 3)
            .map(normalizeParticipant);

        // Display order is 2nd (left), 1st (center), 3rd (right).
        var ordered = [top[1], top[0], top[2]];
        var ranks = [2, 1, 3];

        container.classList.add('dia-podium');
        if (animate) {
            container.classList.add('dia-podium--animate');
        } else {
            container.classList.remove('dia-podium--animate');
        }

        container.setAttribute('role', 'region');
        container.setAttribute('aria-label', 'Leaderboard podium');

        container.innerHTML = '' +
            '<ol class="dia-podium__stage" aria-label="Leaderboard top three">' +
                ordered.map(function (participant, index) {
                    return placeMarkup(participant, ranks[index], animate);
                }).join('') +
            '</ol>';

        // If a remote avatar fails, reveal the initials fallback behind it.
        Array.prototype.forEach.call(
            container.querySelectorAll('[data-dia-avatar-img]'),
            function (image) {
                function removeBrokenImage() {
                    if (image.parentNode) image.parentNode.removeChild(image);
                }

                image.addEventListener('error', removeBrokenImage);

                if (image.complete && image.naturalWidth === 0) {
                    removeBrokenImage();
                }
            }
        );

        if (animate) animatePoints(container);

        return container;
    }

    global.DiaPodium = {
        render: render
    };
}(window));