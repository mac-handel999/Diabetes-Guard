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

    function avatarMarkup(participant, className, isEmpty) {
        var avatar = document.createElement('div');
        var initials = document.createElement('span');

        avatar.className = className + (isEmpty ? ' ' + className + '--empty' : '');
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

    function create(rawParticipants, options) {
        var opts = options || {};
        var ranked = Adapter.assignRanks(rawParticipants);
        var current = Adapter.findParticipant(ranked, opts);

        if (!current && opts.currentParticipant) {
            current = Adapter.toParticipant(opts.currentParticipant);
            current.rank = Number(opts.currentRank);
            if (!Number.isFinite(current.rank) || current.rank <= 0) current.rank = null;
        }

        var total = Number(opts.totalParticipants);
        if (!Number.isFinite(total) || total <= 0) total = ranked.length;

        var bar = document.createElement('div');
        var rankBox = document.createElement('div');
        var rankLabel = document.createElement('small');
        var rankValue = document.createElement('strong');
        var of = document.createElement('span');
        var identity = document.createElement('div');
        var label = document.createElement('span');
        var alias = document.createElement('span');
        var score = document.createElement('div');
        var points = document.createElement('span');
        var pointsLabel = document.createElement('small');

        bar.className = 'dl-your-rank';
        bar.setAttribute('role', 'region');
        bar.setAttribute('aria-label', 'Your leaderboard rank');

        rankBox.className = 'dl-your-rank__rank';
        rankLabel.textContent = 'Rank';
        rankBox.appendChild(rankLabel);
        rankBox.appendChild(rankValue);

        of.className = 'dl-your-rank__of';
        of.textContent = total > 0 ? 'of ' + total : '';
        if (of.textContent) rankBox.appendChild(of);
        bar.appendChild(rankBox);

        if (!current) {
            rankValue.textContent = '—';
            bar.appendChild(avatarMarkup({ name: '', alias: '', avatar: '' }, 'dl-your-rank__avatar', true));

            identity.className = 'dl-your-rank__identity';
            label.className = 'dl-your-rank__label';
            label.textContent = 'Your rank';

            alias.className = 'dl-your-rank__alias';
            alias.textContent = 'Unranked';

            var hint = document.createElement('span');
            hint.className = 'dl-your-rank__name';
            hint.textContent = 'Earn points to join the leaderboard.';

            identity.appendChild(label);
            identity.appendChild(alias);
            identity.appendChild(hint);
            bar.appendChild(identity);

            score.className = 'dl-your-rank__points';
            score.textContent = Adapter.formatPoints(0);
            pointsLabel.textContent = ' pts';
            score.appendChild(pointsLabel);
            bar.appendChild(score);

            bar.setAttribute(
                'aria-label',
                'Your leaderboard rank: unranked. Earn points to join the leaderboard.'
            );

            return bar;
        }

        rankValue.textContent = current.rank ? '#' + current.rank : '—';
        if (current.rank && ranked.filter(function (participant) {
            return participant.points === current.points;
        }).length > 1) {
            rankValue.title = 'Tied on points';
        }

        bar.appendChild(avatarMarkup(current, 'dl-your-rank__avatar', false));

        identity.className = 'dl-your-rank__identity';
        label.className = 'dl-your-rank__label';
        label.textContent = 'Your rank';

        alias.className = 'dl-your-rank__alias';
        alias.textContent = current.alias ? '@' + current.alias : 'Participant';
        if (current.alias) alias.title = '@' + current.alias;

        identity.appendChild(label);
        identity.appendChild(alias);

        if (current.name) {
            var name = document.createElement('span');
            name.className = 'dl-your-rank__name';
            name.textContent = current.name;
            name.title = current.name;
            identity.appendChild(name);
        }

        bar.appendChild(identity);

        score.className = 'dl-your-rank__points';
        score.textContent = Adapter.formatPoints(current.points);
        pointsLabel.textContent = ' pts';
        score.appendChild(pointsLabel);
        bar.appendChild(score);

        var aria = 'Your rank: ' + (
            current.rank
                ? '#' + current.rank + (total > 0 ? ' of ' + total : '')
                : 'unranked'
        ) + '. ';
        aria += current.alias ? '@' + current.alias : 'Participant';
        if (current.name) aria += ', ' + current.name;
        aria += '. ' + Adapter.formatPoints(current.points) + ' points.';
        bar.setAttribute('aria-label', aria);

        return bar;
    }

    function resolveContainer(target) {
        if (typeof target === 'string') return document.querySelector(target);
        return target || null;
    }

    function render(target, rawParticipants, options) {
        var container = resolveContainer(target);

        if (!container) {
            if (global.console && global.console.warn) {
                global.console.warn('[YourRankBar] Container not found:', target);
            }
            return null;
        }

        var bar = create(rawParticipants, options);
        container.replaceChildren(bar);
        return bar;
    }

    global.YourRankBar = {
        create: create,
        render: render
    };
}(window));