(function (global) {
    'use strict';

    var FIELDS = {
        id: ['id', 'user_id', 'userId', 'participant_id', 'participantId'],
        name: ['full_name', 'fullName', 'name', 'display_name', 'displayName', 'username'],
        alias: ['alias', 'anon_handle', 'anonHandle'],
        avatar: ['avatar', 'avatar_url', 'avatarUrl', 'photo', 'image', 'image_url'],
        points: ['total_points', 'totalPoints', 'points', 'score'],
        badges: ['badges']
    };

    function toText(value) {
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        return '';
    }

    function firstText(row, keys) {
        for (var i = 0; i < keys.length; i += 1) {
            var text = toText(row[keys[i]]);
            if (text) return text;
        }
        return '';
    }

    function firstDefined(row, keys) {
        for (var i = 0; i < keys.length; i += 1) {
            var value = row[keys[i]];
            if (value !== undefined && value !== null) return value;
        }
        return undefined;
    }

    function toPoints(value) {
        var number = typeof value === 'string'
            ? Number(value.replace(/,/g, ''))
            : Number(value);
        return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
    }

    function normalizeBadges(value) {
        if (!Array.isArray(value)) return [];

        var seen = Object.create(null);
        return value.map(function (badge) {
            return toText(badge);
        }).filter(function (badge) {
            if (!badge || seen[badge]) return false;
            seen[badge] = true;
            return true;
        });
    }

    function safeImageUrl(value) {
        var url = toText(value);
        if (!url || /^\s*javascript:/i.test(url)) return '';
        if (/^(https?:\/\/|data:image\/|\/|\.{1,2}\/|Images\/)/i.test(url)) return url;
        return '';
    }

    function toParticipant(row) {
        var source = row && typeof row === 'object' ? row : {};
        var alias = firstText(source, FIELDS.alias).replace(/^@+/, '').trim();
        var rank = Number(source.rank);

        return {
            id: firstText(source, FIELDS.id),
            name: firstText(source, FIELDS.name),
            alias: alias,
            avatar: safeImageUrl(firstText(source, FIELDS.avatar)),
            points: toPoints(firstDefined(source, FIELDS.points)),
            badges: normalizeBadges(firstDefined(source, FIELDS.badges)),
            rank: Number.isFinite(rank) && rank > 0 ? rank : null
        };
    }

    function toParticipants(rows) {
        if (!Array.isArray(rows)) return [];
        return rows.map(toParticipant);
    }

    function assignRanks(participants) {
        var list = toParticipants(participants).slice().sort(function (a, b) {
            if (b.points !== a.points) return b.points - a.points;

            var byAlias = a.alias.localeCompare(b.alias);
            if (byAlias !== 0) return byAlias;

            return a.name.localeCompare(b.name);
        });

        var lastPoints = null;
        var lastRank = 0;

        return list.map(function (participant, index) {
            var rank = participant.points === lastPoints ? lastRank : index + 1;
            lastPoints = participant.points;
            lastRank = rank;

            return Object.assign({}, participant, {
                rank: rank,
                position: index + 1
            });
        });
    }

    function findParticipant(participants, options) {
        var list = toParticipants(participants);
        var opts = options || {};
        var id = toText(opts.currentUserId != null ? opts.currentUserId : opts.userId);
        var alias = toText(opts.currentAlias || opts.alias).replace(/^@+/, '').toLowerCase();
        var i;

        if (id) {
            for (i = 0; i < list.length; i += 1) {
                if (list[i].id && list[i].id === id) return list[i];
            }
        }

        if (alias) {
            for (i = 0; i < list.length; i += 1) {
                if (list[i].alias.toLowerCase() === alias) return list[i];
            }
        }

        return null;
    }

    function formatPoints(value) {
        var points = toPoints(value);
        try {
            return points.toLocaleString('en-US');
        } catch (err) {
            return String(points);
        }
    }

    global.LeaderboardAdapter = {
        FIELDS: FIELDS,
        toParticipant: toParticipant,
        toParticipants: toParticipants,
        assignRanks: assignRanks,
        findParticipant: findParticipant,
        formatPoints: formatPoints
    };
}(window));