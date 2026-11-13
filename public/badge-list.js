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

    function presentation(badge) {
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

    function normalize(badges) {
        if (!Array.isArray(badges)) return [];

        var seen = Object.create(null);
        return badges.map(function (badge) {
            return badge == null ? '' : String(badge).trim();
        }).filter(function (badge) {
            if (!badge || seen[badge]) return false;
            seen[badge] = true;
            return true;
        });
    }

    function badgeChip(badge) {
        var details = presentation(badge);
        var chip = document.createElement('span');

        chip.className = 'dl-badge';
        chip.setAttribute('role', 'img');
        chip.setAttribute('tabindex', '0');
        chip.setAttribute('aria-label', 'Badge: ' + details.label);
        chip.setAttribute('data-tooltip', details.label);

        var icon = document.createElement('span');
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = details.emoji;
        chip.appendChild(icon);

        return chip;
    }

    function moreChip(count) {
        var label = count + ' more badge' + (count === 1 ? '' : 's');
        var chip = document.createElement('span');

        chip.className = 'dl-badge dl-badge--more';
        chip.setAttribute('role', 'img');
        chip.setAttribute('tabindex', '0');
        chip.setAttribute('aria-label', label);
        chip.setAttribute('data-tooltip', label);
        chip.textContent = '+' + count;

        return chip;
    }

    function create(badges, options) {
        var opts = options || {};
        var max = Number(opts.max);
        if (!Number.isFinite(max) || max < 1) max = 3;
        max = Math.floor(max);

        var list = normalize(badges);
        var container = document.createElement('div');

        container.className = 'dl-badges';
        container.setAttribute('role', 'group');
        container.setAttribute('aria-label', 'Badges');

        if (!list.length) {
            container.setAttribute('aria-hidden', 'true');
            return container;
        }

        var visible = list.slice(0, max);
        var extraCount = list.length - visible.length;

        visible.forEach(function (badge) {
            container.appendChild(badgeChip(badge));
        });

        if (extraCount > 0) {
            container.appendChild(moreChip(extraCount));
        }

        return container;
    }

    function resolveContainer(target) {
        if (typeof target === 'string') return document.querySelector(target);
        return target || null;
    }

    function render(target, badges, options) {
        var container = resolveContainer(target);

        if (!container) {
            if (global.console && global.console.warn) {
                global.console.warn('[BadgeList] Container not found:', target);
            }
            return null;
        }

        var list = create(badges, options);
        container.replaceChildren(list);
        return list;
    }

    global.BadgeList = {
        create: create,
        render: render
    };
}(window));