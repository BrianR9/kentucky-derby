"use strict";

(function () {

    /* ============================================================
       Kentucky Derby 2026 – Putnam Estate Pool
       derby5-1-25.js – Firebase Realtime Database version

       Replaces localStorage with Firebase Realtime Database.
       All entries and picked horses are stored in Firebase
       and sync in real-time across all connected devices.

       Firebase data structure:
         derby-pool/
           entries/
             0: { name, horse, odds }
             1: { name, horse, odds }
             ...
           pickedHorses/
             0: 8
             1: 17
             ...

       How the listener works:
         The single dataRef.on("value") listener fires:
           – immediately on page load with current data
           – every time any device changes the data
           – automatically on reconnect if connection drops
         All local state is rebuilt from Firebase here.
         Never modify entries/pickedHorses directly –
         always write to Firebase and let the listener
         update local state and the display.

       Admin buttons:
         Next Round          – removes only pickedHorses from Firebase
                               entries stay untouched
         Clear All & Restart – removes entire derby-pool node

       Missing post positions:
         #13 and #20 not in the 2026 official entry list
    ============================================================ */


    /* ── Firebase Configuration ──────────────────────────────── */
    /*
        Replace ALL values below with your own Firebase config.
        Found in Firebase Console → Project Settings → Your apps.
    */
var firebaseConfig = {
    apiKey:            "AIzaSyA5e-9Apvr-qKECcUYoTWOZTuAr5JG4ljY",
    authDomain:        "putnam-derby-pool.firebaseapp.com",
    databaseURL:       "https://putnam-derby-pool-default-rtdb.firebaseio.com",
    projectId:         "putnam-derby-pool",
    storageBucket:     "putnam-derby-pool.firebasestorage.app",
    messagingSenderId: "510674765364",
    appId:             "1:510674765364:web:b162bab1aec91f263f6c61"
};

    /* Initialize Firebase and get a reference to the database */
    firebase.initializeApp(firebaseConfig);
    var db      = firebase.database();
    var dataRef = db.ref("derby-pool");


    /* ── Horse data – 22 runners, official 2026 entry list ───── */
    var horseData = {
        1:  { name: "Renegade",        odds: "5/1"  },
        2:  { name: "Albus",           odds: "50/1" },
        3:  { name: "Intrepido",       odds: "55/1" },
        4:  { name: "Litmus Test",     odds: "34/1" },
        5:  { name: "Right To Party",  odds: "26/1" },
        6:  { name: "Commandment",     odds: "7/1"  },
        7:  { name: "Danon Bourbon",   odds: "14/1" },
        8:  { name: "So Happy",        odds: "6/1"  },
        9:  { name: "The Puma",        odds: "8/1"  },
        10: { name: "Wonder Dean",     odds: "20/1" },
        11: { name: "Incredibolt",     odds: "27/1" },
        12: { name: "Chief Wallabee",  odds: "9/1"  },
        /* 13 – not in official entry list – omitted            */
        14: { name: "Potente",         odds: "23/1" },
        15: { name: "Emerging Market", odds: "11/1" },
        16: { name: "Pavlovian",       odds: "52/1" },
        17: { name: "Six Speed",       odds: "40/1" },
        18: { name: "Further Ado",     odds: "7/1"  },
        19: { name: "Golden Tempo",    odds: "36/1" },
        /* 20 – not in official entry list – omitted            */
        21: { name: "Great White",     odds: "29/1" },
        22: { name: "Ocelli",          odds: "50/1" },
        23: { name: "Robusta",         odds: "50/1" },
        24: { name: "Corona De Oro",   odds: "50/1" }
    };

    /* All valid post position numbers as an array of integers */
    var allHorseNumbers = Object.keys(horseData).map(Number);

    /* Admin password */
    var ADMIN_PASSWORD = "putnam2025";


    /* ── Local state ──────────────────────────────────────────────

       These are kept in sync by the Firebase listener.
       Never write to them directly from button handlers –
       always write to Firebase first and let the listener
       update these variables.

       entries
         All historical entries across all rounds.
         Each entry: { name, horse, odds }
         Controls the display list.

       pickedHorses
         Post positions picked in the current round only.
         Cleared by Next Round.

       userNames
         Rebuilt from entries on every Firebase update.
         Used for duplicate ticket number check.

       pendingHighlight
         Stores the ticket name of the most recently picked entry.
         Set in the click handler BEFORE pushing to Firebase.
         Used by renderAll() to flash the new row when the
         Firebase listener fires and rebuilds the display.
         Cleared after use in renderAll().
    ────────────────────────────────────────────────────────────── */
    var entries          = [];
    var pickedHorses     = [];
    var userNames        = [];
    var pendingHighlight = null;


    /* ================================================================
       FIREBASE HELPER FUNCTIONS
    ================================================================ */

    /**
     * Convert a Firebase snapshot value to a plain JavaScript array.
     *
     * Firebase Realtime Database stores JavaScript arrays as
     * objects with numeric string keys:
     *   [obj1, obj2, obj3]
     *   → { "0": obj1, "1": obj2, "2": obj3 }
     *
     * This function handles both arrays and objects and always
     * returns a correctly ordered array.
     *
     * @param  {*} val - value from Firebase snapshot.val()
     * @return {Array}
     */
    function toArray(val) {
        if (!val) return [];
        if (Array.isArray(val)) return val;

        /* Sort keys numerically to always preserve insertion order */
        return Object.keys(val)
            .sort(function (a, b) { return Number(a) - Number(b); })
            .map(function (k) { return val[k]; });
    }

    /**
     * Save current entries and pickedHorses to Firebase.
     *
     * Uses .update() so only the specified keys are overwritten
     * without affecting any other data in the database.
     *
     * Empty arrays are stored as null so Firebase automatically
     * removes the key and keeps the database clean.
     *
     * @param {Function} [callback] - optional callback(error)
     */
    function saveState(callback) {
        var update = {
            entries:      entries.length > 0      ? entries      : null,
            pickedHorses: pickedHorses.length > 0 ? pickedHorses : null
        };

        dataRef.update(update, function (error) {
            if (error) {
                console.error("Firebase write error:", error);
                alert("Error saving data – please check your connection.");
            }
            if (typeof callback === "function") {
                callback(error);
            }
        });
    }


    /* ================================================================
       FIREBASE REAL-TIME LISTENER

       Single source of truth for all state.
       Fires immediately on page load and again any time
       any connected device changes the database.
    ================================================================ */
    dataRef.on(
        "value",

        /* Success callback */
        function (snapshot) {
            var data = snapshot.val() || {};

            /* Rebuild all local state from Firebase */
            entries      = toArray(data.entries);
            pickedHorses = toArray(data.pickedHorses);
            userNames    = entries.map(function (e) { return e.name; });

            /* Rebuild the entire display */
            renderAll();
        },

        /* Error callback */
        function (error) {
            console.error("Firebase connection error:", error);
            $("#spanName")
                .html(
                    "<i class='fas fa-exclamation-triangle'></i>" +
                    " Database connection error – please refresh the page."
                )
                .css({
                    "color":            "#ef4444",
                    "background-color": "rgba(239, 68, 68, 0.08)"
                });
        }
    );


    /* ================================================================
       LIVE DUPLICATE CHECK while typing
    ================================================================ */
    $("#name").on("keyup input", function () {
        var val = $(this).val().trim();

        /* Empty – reset all field styling */
        if (!val) {
            $(this).css({
                "background-color": "",
                "border-color":     ""
            });
            $("#spanName").html("").css({
                "color":            "",
                "background-color": ""
            });
            return;
        }

        if (userNames.indexOf(val) !== -1) {
            /* Duplicate found */
            $(this).css({
                "background-color": "rgba(239, 68, 68, 0.12)",
                "border-color":     "#ef4444"
            });
            $("#spanName")
                .html(
                    "<i class='fas fa-exclamation-triangle'></i>" +
                    " Duplicate ticket number – please try a different one."
                )
                .css({
                    "color":            "#ef4444",
                    "background-color": "rgba(239, 68, 68, 0.08)"
                });
        } else {
            /* Available */
            $(this).css({
                "background-color": "rgba(16, 185, 129, 0.08)",
                "border-color":     "#10b981"
            });
            $("#spanName")
                .html(
                    "<i class='fas fa-check-circle'></i>" +
                    " Ticket number available"
                )
                .css({
                    "color":            "#10b981",
                    "background-color": "rgba(16, 185, 129, 0.06)"
                });
        }
    });


    /* ================================================================
       PICK MY HORSE button
    ================================================================ */
    $("#pick").on("click", function (e) {

        var name = $("#name").val().trim();

        /* ── Validation ── */
        if (!name) {
            e.preventDefault();
            $("#spanName")
                .html(
                    "<i class='fas fa-exclamation-triangle'></i>" +
                    " Please enter the last 4 digits of your ticket."
                )
                .css({
                    "color":            "#ef4444",
                    "background-color": "rgba(239, 68, 68, 0.08)"
                });
            return;
        }

        if (userNames.indexOf(name) !== -1) {
            e.preventDefault();
            $("#spanName")
                .html(
                    "<i class='fas fa-exclamation-triangle'></i>" +
                    " Duplicate ticket! This number has already been entered."
                )
                .css({
                    "color":            "#ef4444",
                    "background-color": "rgba(239, 68, 68, 0.08)"
                });
            return;
        }

        /* ── Find horses not yet picked this round ── */
        var available = allHorseNumbers.filter(function (h) {
            return pickedHorses.indexOf(h) === -1;
        });

        if (available.length === 0) {
            e.preventDefault();
            $("#spanName")
                .html(
                    "<i class='fas fa-ban'></i>" +
                    " All horses assigned this round – use Next Round to reset!"
                )
                .css({
                    "color":            "#ef4444",
                    "background-color": "rgba(239, 68, 68, 0.08)"
                });
            return;
        }

        /* ── Random pick from available horses ── */
        var bPonny    = available[Math.floor(Math.random() * available.length)];
        var horse     = horseData[bPonny];
        var horseName = horse ? horse.name : "";
        var horseOdds = horse ? horse.odds : "";

        var entry = {
            name:  name,
            horse: bPonny,
            odds:  horseOdds
        };

        /*
            Set pendingHighlight BEFORE saving to Firebase.
            The Firebase listener fires asynchronously and
            uses this value to flash the new entry row when
            renderAll() is called.
        */
        pendingHighlight = name;

        /*
            Update local state immediately so the duplicate
            check and available horses filter work correctly
            if the user tries to pick again before the
            Firebase listener fires.
        */
        entries.push(entry);
        pickedHorses.push(bPonny);
        userNames.push(name);

        /* Save to Firebase – listener will fire and call renderAll() */
        saveState();

        /* ── Animate horse number reveal ── */
        $("#chickenDinner").html(bPonny);

        $("#drawing").fadeOut(1, function () {
            $("#drawing").fadeIn(10000);
        });

        $("#chickenDinner").fadeIn(1000, function () {
            $("#chickenDinner").fadeOut(9000);
        });

        /* ── Success feedback including horse name and odds ── */
        $("#spanName")
            .html(
                "🎉 You got <strong>#" + bPonny +
                " " + horseName +
                "</strong> at <strong>" + horseOdds +
                "</strong> – Good luck!"
            )
            .css({
                "color":            "#f59e0b",
                "background-color": "rgba(245, 158, 11, 0.08)"
            });

        /* Clear feedback and reset input styling after 5 seconds */
        setTimeout(function () {
            $("#spanName").html("").css({
                "color":            "",
                "background-color": ""
            });
            $("#name").css({
                "background-color": "",
                "border-color":     ""
            });
        }, 5000);

        /* type="reset" fires naturally here and clears the input */
    });


    /* ================================================================
       ADMIN – NEXT ROUND button

       Removes only the pickedHorses key from Firebase.
       The Firebase listener fires, pickedHorses rebuilds as []
       and the odds board resets automatically.

       What changes:
         ✅ pickedHorses    – removed from Firebase and reset to []
         ✅ Odds board      – all horses shown as available again

       What stays the same:
         ✅ entries display – previous round entries stay on screen
         ✅ userNames       – duplicate ticket numbers still blocked
         ✅ entries         – Firebase entries node untouched
    ================================================================ */
    $("#doit").on("click", function (e) {
        e.preventDefault();

        var pw = $("#adminKey2").val();

        if (!pw) {
            alert("Please enter the admin password first.");
            return;
        }

        if (pw !== ADMIN_PASSWORD) {
            alert("Incorrect password – access denied.");
            $("#adminKey2").val("");
            return;
        }

        if (confirm(
            "Start a new round?\n\n" +
            "✅ All horses will be available to pick again.\n" +
            "✅ Previous entries stay on screen.\n" +
            "✅ Duplicate ticket numbers still blocked."
        )) {
            /*
                Remove only the pickedHorses child node.
                This does NOT affect the entries node.
                The Firebase listener fires automatically
                and updates local state and the odds board.
            */
            dataRef.child("pickedHorses").remove(function (error) {
                if (error) {
                    console.error("Next Round error:", error);
                    alert("Error starting new round – please try again.");
                } else {
                    alert("Another Round has begun – WTF, this just got interesting!");
                }
            });
        }

        $("#adminKey2").val("");
    });


    /* ================================================================
       ADMIN – CLEAR ALL & RESTART button

       Removes the entire derby-pool node from Firebase.
       The Firebase listener fires with null data so all
       state variables reset to [] and the display clears.

       What changes:
         ✅ entries         – removed from Firebase, display cleared
         ✅ pickedHorses    – removed from Firebase, odds board reset
         ✅ userNames       – rebuilt as [] from empty entries
         ✅ entry count     – reset to 0 entries
         ✅ input field     – styling reset
         ✅ feedback span   – cleared
    ================================================================ */
    $("#clearAll").on("click", function (e) {
        e.preventDefault();

        var pw = $("#adminKey2").val();

        if (!pw) {
            alert("Please enter the admin password first.");
            return;
        }

        if (pw !== ADMIN_PASSWORD) {
            alert("Incorrect password – access denied.");
            $("#adminKey2").val("");
            return;
        }

        if (confirm(
            "⚠ WARNING – This will completely restart the game!\n\n" +
            "❌ All entries will be removed from the screen.\n" +
            "❌ All picked horses will be cleared.\n" +
            "❌ All ticket numbers will be forgotten.\n\n" +
            "This cannot be undone. Are you sure?"
        )) {
            /*
                Remove the entire derby-pool node from Firebase.
                The listener fires with snapshot.val() === null.
                entries, pickedHorses and userNames all become [].
                renderAll() clears #output automatically.
            */
            dataRef.remove(function (error) {
                if (error) {
                    console.error("Clear All error:", error);
                    alert("Error resetting game – please try again.");
                } else {
                    /* Reset input field and feedback span */
                    $("#name").css({
                        "background-color": "",
                        "border-color":     ""
                    });
                    $("#spanName").html("").css({
                        "color":            "",
                        "background-color": ""
                    });
                    alert("Game fully reset – ready for a fresh start! 🏇");
                }
            });
        }

        $("#adminKey2").val("");
    });


    /* ================================================================
       HELPERS
    ================================================================ */

    /**
     * Write a single entry row to #output.
     *
     * Three columns matching CSS layout:
     *   Col 1 (20%) – ticket number (gold, Rajdhani font)
     *   Col 2 (45%) – horse post position and name
     *   Col 3 (35%) – odds as green badge (.entry-odds)
     *
     * @param {object}  entry     - { name, horse, odds }
     * @param {boolean} highlight - if true plays flashGold animation
     */
    function writeRowToPage(entry, highlight) {
        var horse     = horseData[entry.horse];
        var horseName = horse ? horse.name : "";

        /*
            Use odds stored on the entry first.
            Falls back to current horseData in case the entry
            was saved before the odds field was added.
        */
        var horseOdds = entry.odds || (horse ? horse.odds : "");
        var horseLine = "#" + entry.horse + " \u2013 " + horseName;
        var rowClass  = highlight ? "info new-entry" : "info";

        /* Col 1 – ticket number */
        var div1 = $("<div></div>").text(entry.name);

        /* Col 2 – horse post position and name */
        var div2 = $("<div></div>").text(horseLine);

        /* Col 3 – odds as green badge */
        var div3 = $("<div></div>").append(
            $("<span></span>")
                .addClass("entry-odds")
                .text(horseOdds)
        );

        var row = $("<div></div>")
            .attr("class", rowClass)
            .append(div1)
            .append(div2)
            .append(div3);

        $("#output").append(row);
    }

    /**
     * Rebuild the full entries list from the entries array.
     *
     * Called by the Firebase listener every time data changes
     * on any connected device.
     *
     * Uses pendingHighlight to flash the most recently added
     * entry. pendingHighlight is set in the click handler
     * before saving to Firebase and cleared here after use.
     */
    function renderAll() {
        $("#output").html("");

        entries.forEach(function (entry) {
            var highlight = (
                pendingHighlight !== null &&
                entry.name === pendingHighlight
            );
            writeRowToPage(entry, highlight);
        });

        /* Always clear after use so old highlights don't linger */
        pendingHighlight = null;

        updateOddsBoard();
        updateEntryCount();
    }

    /**
     * Grey out and strike through horses picked in the
     * current round on the odds board.
     *
     * Uses pickedHorses (current round only) so the board
     * resets correctly when Next Round is clicked.
     *
     * parseInt() on the full h3 text content correctly extracts
     * the post position number from the span-based structure.
     * e.g. "8So Happy6/1" → parseInt → 8
     */
    function updateOddsBoard() {
        $("#runningHorses .leaderboard").removeClass("taken");

        $("#runningHorses .leaderboard").each(function () {
            var num = parseInt($(this).find("h3").text(), 10);
            if (pickedHorses.indexOf(num) !== -1) {
                $(this).addClass("taken");
            }
        });
    }

    /**
     * Keep the entry count badge in the Entries card header
     * in sync with the total number of entries across all rounds.
     */
    function updateEntryCount() {
        var count = entries.length;
        $("#entry-count").text(
            count + (count === 1 ? " entry" : " entries")
        );
    }

})();