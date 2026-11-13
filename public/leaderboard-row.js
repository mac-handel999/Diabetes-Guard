(function (global) {
    'use strict';

    var Adapter = global.LeaderboardAdapter;

    function initialsFor(participant) {
        var source = participant.name || participant.alias || '';
        var words = source.split(/[\s_.-]+/).filter(Boolean);

        if (!words.length) return '?';
        if (words.length === 1) return words[0].charAt(0).toUpperCase();

        return (
            words[0].charAt(0) + words[words.length - 1].charAt(0)
        ).toUpperCase();
    }

    function avatarMarkup(participant, className) {
        var avatar = document.createElement('div');
        var initials = document.createElement('span');

        avatar.className = className;
        avatar.setAttribute('role', 'img');
        avatar.setAttribute(
            'aria-label',
            participant.name
                ? 'Avatar for ' + participant.name
                : 'Avatar for ' + (participant.alias || 'participant')
        );

        initials.className = 'dl-avatar-initials';
        initials.setAttribute('aria-hidden', 'true');
        initials.textContent = initialsFor(participant);
        avatar.appendChild(initials);

        if (participant.avatar) {
            var image = document.createElement('img');
            var removeBrokenImage = function () {
                if (image.parentNode) image.parentNode.removeChild(image);
            };

            image.src = participant.avatar;
            image.alt = '';
            image.loading = 'lazy';
            image.addEventListener('error', removeBrokenImage);
            avatar.appendChild(image);

            if (image.complete && image.naturalWidth === 0) {
                removeBrokenImage();
            }
        }

        return avatar;
    }

    function matchesCurrent(participant, options) {
        var opts = options || {};
        var id = toText(opts.currentUserId != null ? opts.currentUserId : opts.userId);
        var alias = toText(opts.currentAlias || opts.alias).replace(/^@+/, '').toLowerCase();

        if (id && participant.id && participant.id === id) return true;

        return !!(alias && participant.alias && participant.alias.toLowerCase() === alias);
    }

    function toText(value) {
        if (value == null) return '';
        return String(value).trim();
    }

    function create(rawParticipant, options) {
        var participant = Adapter.toParticipant(rawParticipant);
        var opts = options || {};

        var rank = Number(opts.rank);
        if (!Number.isFinite(rank) || rank <= 0) rank = Number(participant.rank);
        if (!Number.isFinite(rank) || rank <= 0) rank = null;

        var isYou = !!opts.isYou;
        var leaderPoints = Number(opts.leaderPoints);
        if (!Number.isFinite(leaderPoints) || leaderPoints < 0) leaderPoints = 0;

        var percent = leaderPoints > 0
            ? Math.max(0, Math.min(100, (participant.points / leaderPoints) * 100))
            : 0;

        var row = document.createElement('li');
        var main = document.createElement('div');
        var rankEl = document.createElement('span');
        var identity = document.createElement('div');
        var aliasEl = document.createElement('span');
        var score = document.createElement('div');
        var pointsEl = document.createElement('span');
        var pointsLabel = document.createElement('small');
        var labelParts = ['Rank ' + (rank || 'unranked')];

        row.className = 'dl-row' + (isYou ? ' dl-row--you' : '');
        row.setAttribute(
            'aria-label',
            labelParts.concat([
                participant.alias ? '@' + participant.alias : 'Participant',
                participant.name,
                Adapter.formatPoints(participant.points) + ' points',
                participant.badges.length
                    ? participant.badges.length + ' badge' + (participant.badges.length === 1 ? '' : 's')
                    : '',
                isYou ? 'This is you' : ''
            ]).filter(Boolean).join(', ')
        );

        main.className = 'dl-row__main';

        rankEl.className = 'dl-row__rank';
        rankEl.setAttribute('aria-hidden', 'true');
        rankEl.textContent = rank ? String(rank) : '–';
        main.appendChild(rankEl);
        main.appendChild(avatarMarkup(participant, 'dl-row__avatar'));

        identity.className = 'dl-row__identity';

        aliasEl.className = 'dl-row__alias';
        aliasEl.textContent = participant.alias ? '@' + participant.alias : 'Participant';
        if (participant.alias) aliasEl.title = '@' + participant.alias;
        identity.appendChild(aliasEl);

        if (participant.name && participant.name.toLowerCase() !== participant.alias.toLowerCase()) {
            var nameEl = document.createElement('span');
            nameEl.className = 'dl-row__name';
            nameEl.textContent = participant.name;
            nameEl.title = participant.name;
            identity.appendChild(nameEl);
        }

        main.appendChild(identity);

        score.className = 'dl-row__score';

        pointsEl.className = 'dl-row__points';
        pointsEl.textContent = Adapter.formatPoints(participant.points);
        pointsLabel.textContent = ' pts';
        pointsEl.appendChild(pointsLabel);
        score.appendChild(pointsEl);

        if (isYou) {
            var youEl = document.createElement('span');
            youEl.className = 'dl-row__you';
            youEl.textContent = 'You';
            score.appendChild(youEl);
        }

        main.appendChild(score);
        row.appendChild(main);

        if (participant.badges.length && global.BadgeList) {
            var badgeWrap = document.createElement('div');
            badgeWrap.className = 'dl-row__badges';
            badgeWrap.appendChild(global.BadgeList.create(participant.badges));
            row.appendChild(badgeWrap);
        }

        if (opts.showProgress !== false) {
            var progress = document.createElement('div');
            var fill = document.createElement('span');

            progress.className = 'dl-row__progress';
            progress.setAttribute('role', 'progressbar');
            progress.setAttribute('aria-label', 'Points relative to the leader');
            progress.setAttribute('aria-valuemin', '0');
            progress.setAttribute('aria-valuemax', String(leaderPoints));
            progress.setAttribute('aria-valuenow', String(participant.points));

            fill.style.width = percent + '%';
            progress.appendChild(fill);
            row.appendChild(progress);
        }

        return row;
    }

    function resolveContainer(target) {
        if (typeof target === 'string') return document.querySelector(target);
        return target || null;
    }

    function render(target, rawParticipant, options) {
        var container = resolveContainer(target);

        if (!container) {
            if (global.console && global.console.warn) {
                global.console.warn('[LeaderboardRow] Container not found:', target);
            }
            return null;
        }

        var row = create(rawParticipant, options);

        if (container.tagName === 'OL' || container.tagName === 'UL') {
            container.replaceChildren(row);
        } else {
            var list = document.createElement('ol');
            list.className = 'dl-list';
            list.appendChild(row);
            container.replaceChildren(list);
        }

        return row;
    }

    function renderList(target, participants, options) {
        var container = resolveContainer(target);

        if (!container) {
            if (global.console && global.console.warn) {
                global.console.warn('[LeaderboardRow] Container not found:', target);
            }
            return null;
        }

        var opts = options || {};
        var ranked = opts.useExistingRanks && Array.isArray(participants)
            ? participants.map(Adapter.toParticipant)
            : Adapter.assignRanks(participants);

        var skip = Number(opts.skip);
        var limit = Number(opts.limit);
        var rows;

        if (Number.isFinite(skip) && skip > 0) {
            rows = ranked.slice(Math.floor(skip));
        } else {
            var minRank = Number(opts.minRank);
            if (!Number.isFinite(minRank) || minRank < 1) minRank = 4;

            rows = ranked.filter(function (participant) {
                return participant.rank >= minRank;
            });
        }

        if (Number.isFinite(limit) && limit > 0) {
            rows = rows.slice(0, Math.floor(limit));
        }

        var leaderPoints = Number(opts.leaderPoints);
        if (!Number.isFinite(leaderPoints) || leaderPoints < 0) {
            leaderPoints = ranked.length ? ranked[0].points : 0;
        }

        var list = document.createElement('ol');
        list.className = 'dl-list';

        if (!rows.length) {
            var empty = document.createElement('li');
            empty.className = 'dl-list__empty';
            empty.textContent = 'No participants at this position yet.';
            list.appendChild(empty);
        } else {
            rows.forEach(function (participant) {
                list.appendChild(create(participant, {
                    rank: participant.rank,
                    isYou: matchesCurrent(participant, opts),
                    leaderPoints: leaderPoints,
                    showProgress: opts.showProgress !== false
                }));
            });
        }

        container.replaceChildren(list);
        return list;
    }

    global.LeaderboardRow = {
        create: create,
        render: render,
        renderList: renderList
    };
}(window));