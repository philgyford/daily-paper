/**
 * Today's Guardian javascript.
 * https://github.com/philgyford/daily-paper/
 * This file contains various libraries in one file for loading speed.
 *
 * The main code (reader) under the 3-clause BSD License (see LICENSE.txt).
 * Copyright 2010-2011 Phil Gyford (phil@gyford.com http://www.gyford.com/)
 *
 * This file also contains other code with varying licences:
 *
 *  * scrollbarWidth - Calculate the width of the vertical scrollbar.
 *  * ScrollTo - The generic code for handling the "scroll to this position stuff".
 *  * HotKeys - The generic code for handling the keyboard control.
 *  * JSizes - The generic code for detecting/setting sizes of things.
 *  * Live Query - For attaching events to elements when they appear.
 *
 *  Start this all working with:
 *
 *  		$(document).ready(function() {
 * 			reader.initialize();
 * 		});
 *
 *  You can optionally pass this in to the initialize() function:
 * 				{'trackEvents': true}
 *  If you're using Google Analytics, this will then send this call whenever
 *  a new article is viewed:
 *  _gaq.push(['_trackEvent', 'Articles', 'View', reader.issueArticles[idx-1]['path']]);
 *
 *  By default, event tracking is off.
 *
 */


// So we can do things like if ($('.classname').exists()) {}
jQuery.fn.exists = function(){return jQuery(this).length>0;}

// usage: log('inside coolFunc',this,arguments);
// paulirish.com/2009/log-a-lightweight-wrapper-for-consolelog/
window.log = function(){
	log.history = log.history || [];   // store logs to an array for reference
	log.history.push(arguments);
	if(this.console){
		console.log( Array.prototype.slice.call(arguments) );
	}
};

/**
 * Capitalizes first character of a string.
 * eg 'hello'.capitalize() => 'ello'
 */
String.prototype.capitalize = function() {
    return this.charAt(0).toUpperCase() + this.slice(1);
}

/**
 * The custom code for the main functionality of the site.
 */
var reader = {
	
	// Will be of the form YYYY-MM-DD.
	issueDate: '',
	
	// Will be data from the Contents File.
	issueContents: {},
	
	// This will be a list of the data about each article file, in order.
	// Each has keys of: file, path, title, fields, id.
	issueArticles: [],
	
	// Will map the Guardian's article IDs to the 1-based index of the articles in reader.issueArticles.
	// eg, 'world/2010/jul/08/gay/clergyman-jeffrey-john-bishop' => 3
	issueArticleIds: {},
	
	// Will be the 1-based index of the currently-viewed file in reader.issueArticles.
	// Begins on 0 until we view a page.
	currentPos: 0,
	
	// Will be the 1-based index of the current book, as used in #progress.
	currentBook: 1,
	
	// The width (in pixels) of each page of content.
	// Also set in CSS, so change there too, if you change it.
	pageWidth: 610,
	
	// How many pages do we want to load ahead of the one we're viewing now?
	// Currently only pre-loads stuff in the 'Next' direction.
	pagesToPreload: 2,
	
	// Do we want to track certain events with Google Analytics?
	// Set this by passing trackEvents:true as part of options in reader.initialize().
	trackEvents: false,
	
	// Has the vertical scrollbar appeared?
	scrollBarVisible: false,
	
	// Will be true if the browser has touch support, eg iPhone.
	hasTouch: false,

	// Will be true for ipad/iphone/ipodtouch.
	isIOS: false,
	
	// Will be true while the page is moving from one article to another.
	currentlyMoving: false,

	// Keep track of nav that's in the process glowing on/off.
	navGlowing: {'next':false, 'prev':false},
	
	initialize: function(options) {
		if (! options) {
			options = {};
		}
		if (options.trackEvents) {
			reader.trackEvents = options.trackEvents;
		}
		
		reader.hasTouch = reader.hasTouchSupport();
		
		reader.loadContentsFile();

		if (reader.issueDate) {
			reader.processContents();
			reader.initializePage();
		}
	},
	
	
	/**
	 * Clicked the 'next' link, so on to the next story.
	 */
	articleNext: function() {
		reader.moveToArticle(reader.currentPos+1);
	},

	
	/**
	 * Clicked the 'prev' link, so go back to the previous story.
	 */
	articlePrev: function() {
		reader.moveToArticle(reader.currentPos-1);
	},
	
	
	/**
	 * User clicked one of the progress books at the top of the page.
	 * So we need to jump to the first article in that book.
	 * book is the book number, eg from <div id="progress-1">, it's the 1.
	 */
	changeBook: function(book) {
		// Get the CSS ID of the first li in this book, eg 'progress-item-131'
		var firstArticleId = $('#progress-'+book).find('li').first().attr('id');
		// Get the index of the article to jump to, eg 131.
		var idx = parseInt( firstArticleId.substr(firstArticleId.lastIndexOf('-')+1) );
		
		reader.moveToArticle(idx);
		reader.currentBook = book;
	},
	
	
	/**
	 * Sets a cookie containing this issue's date and the Guardian ID of the article we're currently looking at.
	 */
	cookieSet: function() {
		// The 'position' is the ID of the article, like 'law/2010/jul/07/torture-inquiry-witnesses-peter-gibson'.
		var cookieText = 'date:' + reader.issueDate + ':::position:' + reader.issueArticles[reader.currentPos-1]['id'];
		
		Cookies.set('guardian', cookieText, { expires: 2 });
	},

	
	error: function(msg) {
		$('#error').html(msg).show().delay(3000).fadeOut(1000);
	},
	
	
	/**
	 * Make one of the direction arrows glow on and off.
	 * direction is 'next' or 'prev'.
	 * speed is 'normal' or 'fast'.
	 */
	glowNav: function(direction, speed) {
		// Keep track of what's in the process of glowing, so we don't store up
		// multiple glows.
		var in_speed = 300;
		var delay_speed = 1000;
		var out_speed = 1500;
		if (speed == 'fast') {
			delay_speed = 0;
			out_speed = 500;
		} else if (speed == 'slow') {
			delay_speed = 2500;
		};
		if ( ! reader.navGlowing[direction]) {
			reader.navGlowing[direction] = true;
			$('#'+direction+' span').fadeIn(in_speed).delay(delay_speed).fadeOut(out_speed, function(){
				reader.navGlowing[direction] = false;
			});
		};
	},
	
	
	/**
	 * Based on the touch handling in the lovely jQTouch: http://jqtouch.com/
	 * This is a trimmed-down, more specific version for this project.
	 * This method is called when a touchstart event happens on the <body>.
	 */
	handleTouch: function(e) {
		var $el = $(e.target);
		
		if (event) {
			var startX = event.changedTouches[0].clientX,
				startY = event.changedTouches[0].clientY,
				startTime = (new Date).getTime(),
				deltaX = 0,
				deltaY = 0,
				deltaT = 0;

			// Let's bind these after the fact, so we can keep some internal values.
			$el.bind('touchmove', touchMove).bind('touchend', touchEnd);
		}
		
		function touchMove(e) {
			updateTouch();

			var absX = Math.abs(deltaX);
			var absY = Math.abs(deltaY);
			
			// User must swipe 1/5 the width of the screen to move on.
			var swipeLength = $('.current').width() / 5;

			// Check for swipe
			if (absX > absY && (absX > swipeLength) && deltaT < 1000) {
				$el.unbind('touchmove touchend');
				if (deltaX < 0) {
					// Left swipe.
					reader.articleNext();
				} else {
					// Right swipe.
					reader.articlePrev();
				}
			}
		}

		function touchEnd() {
			updateTouch();
			$el.unbind('touchmove touchend');
		}

		function updateTouch() {
			var first = event.changedTouches[0] || null;
			deltaX = first.clientX - startX;
			deltaY = first.clientY - startY;
			deltaT = (new Date).getTime() - startTime;
		}
	},
	
	
	/**
	 * Is this an iPhone or similar?
	 * Sets a class of iphone/ipad/android on the <body> if so,
	 * and returns true/false.
	 */
	hasTouchSupport: function(){
		// Also returns true for Google Chrome.
	 	// * "Borrowed" from http://uxebu.com/blog/2010/04/27/touchscroll-a-scrolling-layer-for-webkit-mobile/
		// if("createTouch" in document){ // True on the iPhone
		// 	return true;
		// }
		// try{
		// 	var event = document.createEvent("TouchEvent"); // Should throw an error if not supported
		// 	return !!event.initTouchEvent; // Check for existance of initialization method
		// }catch(error){
		// 	return false;
		// }
		
		// not ideal, but seems like there's no foolproof way of detecting touch support without snagging chrome too.

		if (navigator.userAgent.indexOf('iPhone') != -1
			||
			navigator.userAgent.indexOf('iPod') != -1) {
			$('body').addClass('iphone');
			reader.isIOS = true;
			return true;
		} else if (navigator.userAgent.indexOf('iPad') != -1) {
			$('body').addClass('ipad');
			reader.isIOS = true;
			return true;
		} else if (navigator.userAgent.indexOf('Android') != -1) {
			$('body').addClass('android');
			return true;
		};

		return false;
	},

	
	/**
	 * Set up all the initial stories, the events, positions, etc.
	 */
	initializePage: function() {
		if (reader.hasTouch) {
			// For iPhone, iPad etc.
			
			// .touch will mean other styles are applied to elements.
			// And we add the touchstart event for detecting left/right swipes.
			$('body').addClass('touch').bind('touchstart', reader.handleTouch);
		}
		
		var paperName = reader.issueContents.meta.paper_name.charAt(0).toUpperCase() + reader.issueContents.meta.paper_name.slice(1);
		
		// Add the name of the paper ("The Observer") and the full date.
		$('#paper-date').html(
			'The ' + paperName + ', ' + reader.issueDateLong()
		);
		document.title = "Today's "+paperName;
		
		// Gets either 1, or the ID of the article in the user's cookie.
		var initialArticleIdx = reader.getInitialArticleIdx();

		// After this reader.currentPos will be set.
		// But probably too late to be of use here, but we can keep using
		// articleIdx.
		reader.moveToArticle(initialArticleIdx);

		$('div#page-'+initialArticleIdx+' div.body').livequery(function(){
			// For some reason the first article doesn't finish loading
			// when resizePage() is first called on iPad etc, so we call it
			// again once we know things have loaded.

			// But, also, newer: If the first page contains iframe(s) containing
			// a page with an image in, then those iframes won't be sized correctly
			// by our sizing JS (in resizeArticle()). We'd have to move to another
			// page and back again for it to work. But it seems like calling
			// resizePage() again fixes the problem.
			reader.resizePage();
		});

		if (reader.hasTouch) {
			// iPhone etc.
			// Occasionally we get an article that's so short it doesn't fill the
			// full width of the page. And because we don't have any fixed widths
			// for .touch styles (because it screws up iPhone scaling) the page
			// shrinks to the min-width. And that screws up the transform to/from
			// the too-small page.
			// So we're going to manually set the width of all the .pages based on
			// the width of the #window (minus the padding applied to the .pages).
			$('.page').width(
				  $('#window').width()
				- $('#page-'+reader.currentPos).padding().left
				- $('#page-'+reader.currentPos).padding().right
			);
		};

		// Make the nav appear briefly where available.
		if (initialArticleIdx == 1) {
			// First article.
			reader.glowNav('next', 'slow');
		} else if (initialArticleIdx == reader.issueArticles.length) {
			// Last article.
			reader.glowNav('prev', 'slow');
		} else {
			reader.glowNav('next', 'slow');
			reader.glowNav('prev', 'slow');
		};

		// Set the next/prev links and main content position to change if we
		// resize the window.
		$(window).resize(function(){
			reader.resizePage();
		});
		$('body').bind('orientationchange', reader.resizePage);

		// Set up the next/prev buttons to go to the next/prev story, but only if
		// they're 'on'.
		// They're not 'on' when at the beginning or end of the articles as
		// appropriate.
		$('body').on('click', '.off#next', function(){return false;});
		$('body').on('click', '.on#next', function(){
			if (reader.hasTouch) {
				reader.glowNav('next', 'fast');
			};
			reader.articleNext();
			return false;
		});
		$('body').on('click', '.off#prev', function(){return false;});
		$('body').on('click', '.on#prev', function(){
			if (reader.hasTouch) {
				reader.glowNav('prev', 'fast');
			};
			reader.articlePrev();
			return false;
		});
			
		reader.enableKeyboardShortcuts();
		
		$('a#about').click(function(){
			reader.showAbout();
			return false;
		});

    $('a.alert-close').click(function(ev){
      ev.preventDefault();
      $('.alert').slideUp();
    });
	},


	/**
	 * When page is initialized, and whenever we open a modal dialog.
	 */
	enableKeyboardShortcuts: function() {
		$(document).bind('keydown', 'd', function(){ reader.articleNext(); });
		$(document).bind('keydown', 'shift+d', function(){ reader.bookNext(); });
		$(document).bind('keydown', 'l', function(){ reader.articleNext(); });
		$(document).bind('keydown', 'shift+l', function(){ reader.bookNext(); });
		$(document).bind('keydown', 'right', function(){ reader.articleNext(); });
		$(document).bind('keydown', 'shift+right', function(){ reader.bookNext(); });
		
		$(document).bind('keydown', 'a', function(){ reader.articlePrev(); });
		$(document).bind('keydown', 'shift+a', function(){ reader.bookPrev(); });
		$(document).bind('keydown', 'h', function(){ reader.articlePrev(); });
		$(document).bind('keydown', 'shift+h', function(){ reader.bookPrev(); });
		$(document).bind('keydown', 'left', function(){ reader.articlePrev(); });
		$(document).bind('keydown', 'shift+left', function(){ reader.bookPrev(); });
		
		$(document).bind('keydown', 'j', function(){ reader.movePage('down'); });
		$(document).bind('keydown', 's', function(){ reader.movePage('down'); });
		
		$(document).bind('keydown', 'v', function(){ reader.openOriginal(); });

		$(document).bind('keydown', 'space', function(){
			// Use default space action, unless we're at end of page.
			if (reader.whereAmI().is_at_last) {
				reader.articleNext();
			} else {
				return true;
			}
		 });
		$(document).bind('keydown', 'k', function(){ reader.movePage('up'); });
		$(document).bind('keydown', 'w', function(){ reader.movePage('up'); });
		$(document).bind('keydown', 'shift+space', function(){
			// Use default shift+space action, unless we're at top of page.
			if (reader.whereAmI().is_at_top) {
				reader.articlePrev();
			} else {
				return true;
			}
		});
	},


	/**
	 * When we open a modal dialog.
	 */
	disableKeyboardShortcuts: function() {
			$(document).unbind('keydown');
	},
	
	
	/**
	 * Takes reader.issueDate and returns it in the form 'Thursday 27 May 2010'.
	 */
	issueDateLong: function() {
		var weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
		var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
		
		var dateParts = reader.issueDate.split('-');
		var year = dateParts[0];
		var month = dateParts[1];
		var day = dateParts[2];
		// Remove leading zeros.
		if (month.substring(0, 1) == '0') {
			month = month.substring(1);
		}
		if (day.substring(0, 1) == '0') {
			day = day.substring(1);
		}
		
		var date = new Date();
		date.setFullYear(year, month-1, day);
		var weekday = date.getDay();

		return weekdayNames[weekday] + ' ' + day + ' ' + monthNames[month-1] + ' ' + year;
	},
	
	
	/**
	 * Load the HTML from the article file for this article.
	 * idx is the numerical, 1-based index of the filename from reader.issueArticles.
	 * position is either 'onscreen' (this is the article we're about to view) or
	 * 'offscreen' (for cached articles).
	 */
	loadArticleFile: function(idx, position) {
		if ( $('#page-'+idx).exists() && ! $('#page-'+idx).hasClass('loaded') ) {
			// Only load the contents if the #page-idx exists and has no contents.
			$.ajax({
				url: 'archive/' + reader.issueDate + '/' + reader.issueArticles[idx-1]['file'],
				dataType: 'html',
				data: {},
				async: true,
				success: function(returnedData) {
					$('#page-'+idx).html(returnedData).addClass('loaded');
					// Highlight the whole of the shortURL <input> when selected.
					$('#page-'+idx+' input').focus(function() {
						$(this).select();
					}).mouseup(function(e){
						e.preventDefault();
					});
					// Make the newly-loaded article the correct size.
					reader.resizeArticle($('#page-'+idx), position);
				},
				error: function(XMLHttpRequest, textStatus, errorThrown) {
					reader.error("Can't load article file: "+textStatus + ', '+errorThrown);
				}
			});
		}
	},
	
	
	/**
	 * Load the prev/next article(s) off-screen.
	 * Used when we move to a new article (including the first one).
	 */
	loadCachedArticles: function() {
		for (n=1; n<=reader.pagesToPreload; n++) {
			// loadArticleFile() will only load if the pages asked for exist and aren't already loaded.
			reader.loadArticleFile(reader.currentPos+n, 'offscreen');
			reader.loadArticleFile(reader.currentPos-n, 'offscreen');
		}
	},
	
	
	/**
	 * Load the contents file for today.
	 * Or, if that doesn't exist, load the one for yesterday.
	 */
	loadContentsFile: function() {
		var issueDate = reader.makeIssueDate('today');
		
		$.ajax({
			url: 'archive/' + issueDate + '/contents.json',
			dataType: 'json',
			data: {},
			async: false,
			success: function(returnedData) {
				// Yes, we have today's contents.
				reader.issueDate = issueDate;
				reader.issueContents = returnedData;
			},
			error: function(XMLHttpRequest, textStatus, errorThrown) {
				// No file for today found. Let's try yesterday.
				issueDate = reader.makeIssueDate('yesterday');
				
				$.ajax({
					url: 'archive/' + issueDate + '/contents.json',
					dataType: 'json',
					data: {},
					async: false,
					success: function(returnedData) {
						// Yes, we have yesterday's contents.
						reader.issueDate = issueDate;
						reader.issueContents = returnedData;
					},
					error: function(XMLHttpRequest, textStatus, errorThrown) {
						// Oops, don't have yesterday's contents either.
						reader.error("Can't load contents file: "+textStatus + ', '+errorThrown);
					}
				});
			}
		});
	},
	

	/**
	 * Which article do we display when first arriving at the page?
	 * If there's no cookie, it's the first one.
	 * If there is a cookie we'll jump straight to the one with the ID in their
	 * (if it's in today's paper).
	 * This method just returns the articleIdx to display first.
	 */
	getInitialArticleIdx: function() {
		// The article number we're going to move to.
		var articleIdx = 1;

		var cookieText = Cookies.get('guardian');

		if (cookieText) {
			var cookieDate, cookieId;
		
			// Cookie is like 'date:2010-07-30:::position:uk/2010/jul/07/raoul-moat-hunt-police-appeals'.
			$.each(cookieText.split(':::'), function(n, textPair) {
				var keyVal = textPair.split(':');
				switch(keyVal[0]) {
					case 'date':
						// Like '2010-07-30'.
						cookieDate = keyVal[1];
						break;
					case 'position':
						// Like 'uk/2010/jul/07/raoul-moat-hunt-police-appeals'.
						cookieId = keyVal[1];
						break;
				}
			});

			if (cookieDate == reader.issueDate) {
				// Get the 'page-34' type CSS id of the article.
				if (cookieId in reader.issueArticleIds) {
					articleIdx = reader.issueArticleIds[cookieId];
				} else {
          Cookies.remove('guardian');
				}
			} else {
				// Cookie is for a previous issue of the paper, so we won't need it any more. Unset it.
				Cookies.remove('guardian');
			}
		}

		return articleIdx;
	},
	
	
	/**
	 * Returns a date of the format '2010-05-25'.
	 * day can be 'today' or 'yesterday'.
	 */
	makeIssueDate: function(day) {
		
		var d = new Date();
		
		if (day == 'yesterday') {
			d.setDate(d.getDate()-1)
		}
		
		var day = d.getDate();
		day = day + '';
		if (day.length == 1) {
			day = '0'+day;
		}
		
		var month = d.getMonth();
		month++;
		month = month + '';
		if (month.length == 1) {
			month = '0'+month;
		}
		
		var year = d.getFullYear();
		
		return year + '-' + month + '-' + day;
	},
	
	
	/**
	 * For scrolling the page up or down.
	 * From http://github.com/hiddenloop/paging_keys_js/
	 * movement is either 'up', 'down' or 'top'.
	 * callback can be a function name.
	 */
	movePage: function(movement, callback) {
		var p = reader.whereAmI();

		if (movement == 'up' && p.is_at_top) {
			reader.articlePrev();

		} else if (movement == 'down' && p.is_at_last) {
			reader.articleNext();

		} else {
			// We're doing some scrolling.

			// We don't scroll full screens - we leave a bit of overlap. This many pixels.
			var overlap = 40;

			// Set the base scroll speed to 1000ms per 2000px.
			var scrollSpeed = p.clientHeight / 4;
			
			if (movement == 'top') {
				// Going to the top of the page.
				var distanceLeft = p.top;
				var scrollDuration = Math.round(scrollSpeed * (distanceLeft/(p.clientHeight)));
				var newPos = 0;
				
			} else if (movement == 'up') {
				// Scroll up less than one screen.

				// How far is there left to scroll up?
				var distanceLeft = p.top;
				if (distanceLeft >= p.clientHeight - overlap) {
					// There's more than one screen's worth of scroll, so just go.
					distanceLeft = p.clientHeight - overlap;
					var scrollDuration = scrollSpeed;

				} else {
					// We're less than a screen away from the top of the page.
					// So work out the time it should take to get to the top
					// keeping the speed proportionate to a full screens-worth.
					var scrollDuration = Math.round(scrollSpeed * (distanceLeft/(p.clientHeight)));

				}
				var newPos = p.top - p.clientHeight + overlap;
				if (newPos < 0) {
					newPos = 0;
				}
				
			} else if (movement == 'down') {
				// Scroll down less than one screen.

				// How far is there left to scroll down?
				var distanceLeft = p.height - p.clientHeight - p.top;
				if (distanceLeft >= p.clientHeight - overlap) {
					// There's more than one screen's worth of scroll, so just go.
					distanceLeft = p.clientHeight - overlap;
					var scrollDuration = scrollSpeed;

				} else {
					// We're less than a screen away from the end of the page.
					// So work out the time it should take to get to the end
					// keeping the speed proportionate to a full screens-worth.
					var scrollDuration = Math.round(scrollSpeed * (distanceLeft/(p.clientHeight)));

				}
				var newPos = p.top + p.clientHeight - overlap;
			}
			
			var settings = {duration:scrollDuration};
			if (typeof callback != undefined) {
				settings['onAfter'] = callback;
			}
			$.scrollTo(newPos, settings);
		}
	},
	
	
	/**
	 * Move to a new article.
	 * idx is the 1-based index of the article in reader.issueArticles.
	 */
	moveToArticle: function(idx) {
		var fromIdx = reader.currentPos;
		var toIdx = idx;
		
		// Are we going onward (next) or backward (prev)?
		var direction = 'next';
		if (toIdx < reader.currentPos) {
			direction = 'prev';
		}
		
		if (direction == 'next' && fromIdx == reader.issueArticles.length) {
			// We're on the last page and can't go forward, so forget it.
			return;
		} else if (direction == 'prev' && fromIdx <= 1) {
			// We're on the first page and can't go backwards, so forget it.
			return;
		} else if (reader.currentlyMoving) {
			// The page is currently moving to a different article, so don't start another movement.
			return;
		}
		
		// OK, we're going to move...

		reader.currentlyMoving = true;
		
		// We might be jumping to a page that we haven't already loaded, so load it.
		// (If it's already present, this will do nothing.)
		reader.loadArticleFile(toIdx, 'onscreen');
		
		// This function will be called after any movement to new pages has completed.
		function resetPagePosition() {
			if (fromIdx == 0 && toIdx > 1) {
				// First article viewed this visit, but it's not the first one in the list.
				$('#page-1').removeClass('current');
			} else {
				$('#page-'+fromIdx).removeClass('current');
			}
			$('#page-'+toIdx).addClass('current');
			
			var p = reader.whereAmI();
			if (p.is_at_top) {
				// If we're already at the top of the page, go to the pre-loading
				// of another page.
				reader.moveToArticleAfter(toIdx);
			} else {
				// We're not at the top of the page, so scroll, then pre-load.
				reader.movePage('top', function(){reader.moveToArticleAfter(toIdx)});
			}
		}
		
		if (reader.hasTouch) {
			// iPhone etc.
			
			// "function" in iOS 10, "object" before that:
			if (typeof WebKitTransitionEvent == "object" || typeof WebKitTransitionEvent == "function") {
				// We have nice animations, so slide away...
				
				if (fromIdx == 0 && toIdx == 1) {
					// If the user comes here with no cookie, then we're going to
					// page 1.
					// No fancy transitions required.
					resetPagePosition();
					
				} else {
					// Callback for after the transition has finished.
					$('#page-'+fromIdx).one('webkitTransitionEnd', function(event){
						resetPagePosition();
					});
					
					if (direction == 'next') {
						// Sliding left - move current article to left, remove
						// 'right' status from next one.
						$('#page-'+fromIdx).addClass('left');
						$('#page-'+toIdx).removeClass('right');
					} else {
						// Sliding right - move current article to right, remove
						// 'left' status from previous one.
						$('#page-'+fromIdx).addClass('right');
						$('#page-'+toIdx).removeClass('left');
					}

					if (toIdx - fromIdx < -1 || toIdx - fromIdx > 1) {
						// We're jumping to more than the immediately next/prev
						// article.
						// We need to set all the pages that are now to the right
						// of the current article to have a class of 'right'.
						// And vice versa.
						$('.page:gt('+(toIdx-1)+')').removeClass('left').addClass('right');
						$('.page:lt('+(toIdx-1)+')').removeClass('right').addClass('left');
					}
					
					if (fromIdx == 0) {
						// This is the first page we're viewing.
						// Because there's been no real movement (apparently), the
						// webkit-transition that usually happens
						// when we change the .left and .right classes doesn't
						// happen. So the webkitTransitionEnd callback
						// doesn't happen. So we need to manually call:
						resetPagePosition();
					}
				}
				
			} else {
				// No animation - just flip from one to the other.
				$('#page-'+fromIdx).hide();
				$('#page-'+toIdx).show();
				resetPagePosition();
			}
			
		} else {
			// Standard website. Slide using javascript.
			$('#pages').animate({left: -$('#page-'+toIdx).position().left}, 200, function() {
				resetPagePosition();
			});
		}
	},
	
	
	/**
	 * Called after moveToArticle has finished moving the divs into position.
	 * Loads any new (currently hidden) content, sets navigation, etc.
	 */
	moveToArticleAfter: function(idx) {
		
		$('#progress-item-'+reader.currentPos).parent().parent().removeClass('on');
		$('#progress-item-'+reader.currentPos).removeClass('on');

		reader.currentPos = idx;
		
		// Get the ID (like 'progress-2') of the book this article is in.
		var bookTextId = $('#progress-item-'+reader.currentPos).parent().parent().attr('id');
		// Set the currentbook to the numeric ID of the book.
		reader.currentBook = parseInt(bookTextId.substr(bookTextId.lastIndexOf('-')+1));

		$('#progress-'+reader.currentBook).addClass('on');
		$('#progress-item-'+reader.currentPos).addClass('on');
		
		// Set the height of the window to the height of the article we're now viewing.
		$('#window').height($('#page-'+reader.currentPos).height());
		
		// In case scrollbars have appeared/disappeared and changed page width.
		reader.resizePage();

		// Pre-load more pages.
		reader.loadCachedArticles();

		if (reader.currentPos == reader.issueArticles.length) {
			// On the last page.
			reader.switchNav('next', 'off');
			reader.switchNav('prev', 'on');
		} else if (reader.currentPos == 1) {
			reader.switchNav('next', 'on');
			reader.switchNav('prev', 'off');
		} else {
			reader.switchNav('next', 'on');
			reader.switchNav('prev', 'on');
		}
		
		reader.currentlyMoving = false;
		
		reader.trackView(idx);
		
		reader.cookieSet();
	},
	
	
	openOriginal: function() {
		window.open( reader.issueArticles[reader.currentPos-1]['webUrl'] );
		return false;
	},

	
	/**
	 * Creates the progress stuff - the markers across the top of the page.
	 * ALSO: Creates all the empty <div class="page">'s which will contain the article text.
	 */
	processContents: function() {
		$.each(reader.issueContents.books, function(n, book) {
			
      // Make book names a bit shorter by turning things like
      // "Guardian review" into "Review".
      var bookName = book.meta.webTitle.replace(/^(Guardian|Observer) /, '').capitalize()

			// Make a <div> to hold the progress markers for each book.
			$progressDiv = $('<div/>').attr({
				'id': 'progress-'+(n+1)
			}).html('<span>'+bookName+'</span>').click(function(){
				reader.changeBook(n+1);
			});
			
			// And this <ol> will go within that div.
			$progressList = $('<ol/>');
			
			$.each(book.articles, function(m, article) {
				// Go through each article in this book and add to the progress
				// and contents.

				// Add this one to the list of articles.
				reader.issueArticles.push(article);
				
				// Map the Guardian's long IDs to the position of this article in
				// reader.issueArticles.
				reader.issueArticleIds[article.id] = reader.issueArticles.length;
				
				var lengthPercent = Math.round((article.fields.wordcount / reader.issueContents.meta.max_words) * 100);
				
				// Work out the height of this <li>, in proportion to its length.
				var maxHeight = reader.hasTouch ? 15 : 12;
				
				var actualHeight = Math.round(maxHeight * lengthPercent / 100);
				if (actualHeight == 0) {
					actualHeight = 1;
				}
				
				$progressList.append(
					$('<li/>').attr({
						'id': 'progress-item-'+reader.issueArticles.length
					}).append(
						$('<span/>').height(actualHeight)
					)
				);
				
				var className = 'page';
				if (n == 0 && m == 0) {
					// First page, which will be visible.
					className += ' current';
				} else if (reader.hasTouch) {
					// All articles start to the right of the first one.
					// But we're only using left/right classes for touch devices.
					className += ' right';
				}
				$('#pages').append(
					// No idea why we need to add some HTML to it.
					// If we don't, then when we jump to a new book we seem to
					// get the wrong page.
					$('<div/>').addClass(className).attr({id:'page-'+reader.issueArticles.length}).html('&nbsp;')
				);
			});
			
			$('#progress').append($progressDiv.append($progressList));
		});

		// Width of the progress bar might be set to 'compact' in resizePage().
		
		if ( ! reader.hasTouch) {
			// Set the width of div#pages to the width of all its contents.
			$('#pages').width( $('.page').size() * reader.pageWidth );
		};
	},
	
	
	/**
	 * Set the dimensions of the next/prev links and main content.
	 * Called when the page is first drawn, whenever the window is resized, and
	 * when we move to a new article.
	 *
	 * Scrollbar detection:
	 * http://stackoverflow.com/questions/2571514/is-detecting-scrollbar-presence-with-jquery-still-difficult
	 */
	resizePage: function() {
		
		if (reader.hasTouch) {
			var articleWidth = $('div#window').innerWidth()
								- $('div.page').padding().left
								- $('div.page').padding().right;
			$('div.page').width( articleWidth );
			$('div.body').width( articleWidth );
			// Make sure footer is correct width, or long URLs will extend it.
			$('div.footer').width( articleWidth );
		};	

		// Go through the currently-viewed article and one to either side,
		// resize its height and the next/prev links (for the current article).
		$.each(['current', 'next', 'prev'], function(idx, article) {
			if (article == 'current') {
				reader.resizeArticle( $('.current'), 'onscreen');
			} else if (article == 'next') {
				reader.resizeArticle( $('.current').next(), 'offscreen');
			} else {
				reader.resizeArticle( $('.current').prev(), 'offscreen');
			};
		});


		if ($('#about-page:visible').exists()) {
			reader.setAboutSize();
		};
		// Set whether there's enough room to show the full-width progress bar
		// or if it's wrapping onto another line, in which case, compact.
		if ($('#progress').height() > $('#progress div').height()) {
			$('#progress').addClass('compact');
		};
	},
	

	/**
	 * Resize a single .page article.
	 * Makes sure the article is the correct height, and next/prev nav are the
	 * correct width.
	 * $obj is a jQuery object representing a div.page element.
	 * position is either 'onscreen' or 'offscreen', depending on if this is
	 * visible or not.
	 */
	resizeArticle: function($obj, position) {

    var viewportHeight = window.innerHeight ? window.innerHeight : $(window).height();

		//if ($.browser.msie) {
			//if(parseInt($.browser.version) == 7) {
				//viewportHeight -= 3;
			//};
		//};

		// Some pages include iframes that load HTML pages containing an image.
		// So for each of them, find the 'body' element of the included page
		// and set the iframe to the height of it.
		$('iframe', $obj).each(function(idx){
			// Because we're on http, if the iframe contains an https request,
			// like to youtube.com, the contents() causes an exception. For now,
			// we'll just move on if that happens.
			try{
				$body = $(this).contents().find('body');
				if ($body) {
					$(this).height($body.outerHeight(true));
				};
			} catch(e) {};
		});

		// The height of all the elements that don't change from one article to
		// the next.
		var furnitureHeight = $('#main').padding().top
				+ $('#main').padding().bottom
				+ $('#title').height()
				+ $('#progress').outerHeight(true)
				+ $('#footer').outerHeight(true);
		
		// Height of this article, not including the .body element.
		var articleHeightMinusBody = $('.meta', $obj).outerHeight(true)
			+ $('.meta', $obj).border().bottom
			+ $('.headline h2', $obj).outerHeight(true)
			+ $('.intro .byline', $obj).outerHeight(true)
			+ $('.intro .standfirst', $obj).outerHeight(true)
			+ $('.footer', $obj).outerHeight(true);

		var articleHeight = articleHeightMinusBody + $('.body', $obj).height();

		// If tooShort==true, there'll be no scrollbar when this article is
		// visible.
		var tooShort = (articleHeight + furnitureHeight) <= viewportHeight ? true : false;
		
		if (tooShort) {
			// Stretch article body so it'll fill the page.
			$('div.body', $obj).height(
				$(window).height()
				- furnitureHeight
				- articleHeightMinusBody
			);

		} else {
			$('div.body', $obj).height('auto');
		};


		if (position == 'onscreen') {
			// Set the next/prev areas to the correct width, depending on
			// whether the scrollbar is visible.
			var scrollbarWidth = $.scrollbarWidth();

			if (tooShort) {
				// We need to add space to the right of short articles so that
				// everything is the same width as when the scrollbar is there,
				// to stop things jiggling.
				var prevWidth = (
						$(window).width() - scrollbarWidth - $('#main').width()
					) / 2;

				var nextWidth = prevWidth + scrollbarWidth;
			} else {
				var prevWidth = ( $(window).width() - $('#main').width() ) / 2;
				var nextWidth = prevWidth;
			};

			$('#wrapper').margin({'right': nextWidth});
			
			$('#next').width(
				nextWidth
			).height(
				$(window).height()
			).css({
				'line-height': ($('#next').innerHeight() * 0.96) +'px'
			});
	
			$('#prev').width(
				prevWidth
			).height(
				$(window).height()
			).css({
				'line-height': ($('#prev').innerHeight() * 0.96) +'px'
			});

			$('#window').height($('div.current').height());
		};
	},
	
	
	/**
	 * Jump ahead one book.
	 */
	bookNext: function() {
		var bookToMoveTo = reader.currentBook + 1;
		if ($('#progress-'+bookToMoveTo).exists()) {
			reader.changeBook(bookToMoveTo);
		}
	},
	
	
	/**
	 * Jump back one book.
	 * (Or to start of current book if we're not already at the start of it.)
	 */
	bookPrev: function() {
		// Chances are we're just moving to the first article in the current book.
		var bookToMoveTo = reader.currentBook;
		
		// Get CSS ID of the first article in the book before the current one.
		var firstArticleId = $('#progress-'+reader.currentBook).find('li').first().attr('id');
		// Get the index of the article to jump to, eg 131.
		var firstArticleIdx = parseInt( firstArticleId.substr(firstArticleId.lastIndexOf('-')+1) );
		
		// But, if we're on the first article of this book, jump back to the previous ection.
		if (reader.currentPos == firstArticleIdx) {
			bookToMoveTo = reader.currentBook - 1;
		}
		
		if ($('#progress-'+bookToMoveTo).exists()) {
			reader.changeBook(bookToMoveTo);
		}
	},
	
	
	/**
	 * Show the 'About' page.
	 */
	showAbout: function() {
		reader.disableKeyboardShortcuts();
		reader.setAboutSize();
		$('#about-page').show(0, function(){
			$('#about-page-inner').load('about.html');
			$('#about-page .close').click(function(){
				$('#about-page').hide();
				reader.enableKeyboardShortcuts();
				return false;
			})
		});
	},

	setAboutSize: function() {
		$('#about-page').width(parseInt($(window).width() * 0.75));
		var leftPos = ($(window).width() - $('#about-page').outerWidth()) / 2;
		$('#about-page').css({left: leftPos});
	},
	
	
	/**
	 * Set the next/prev nav to either their on or off state.
	 * direction is either 'next' or 'prev'.
	 * state is either 'on' or 'off'.
	 */
	switchNav: function(direction, state) {
		if ($('#'+direction).hasClass(state)) {
			// No need to do anything.
			return;
		};
		var titleText = 'Next (d, l)';
		if (direction == 'prev') {
			titleText = 'Previous (a, h)';
		};
		if (state == 'on') {
			$('#'+direction).addClass('on').removeClass('off').attr({title:titleText});
			if ( ! reader.hasTouch) {
				$('#'+direction).hover(
					function() {
						reader.glowNav(direction, 'normal');
					},
					function(){}
				);
			};
		} else {
			$('#'+direction).addClass('off').removeClass('on').attr({title:''});
			$('#'+direction).unbind('click mouseenter mouseleave');
		};
	},
	
	
	/**
	 * If we're tracking events, register a view of an article.
	 */
	trackView: function(idx) {
		if (reader.trackEvents && typeof _gaq != 'undefined') {
			_gaq.push(['_trackEvent', 'Articles', 'View', reader.issueArticles[idx-1]['path']]);
		}
	},
	
	
	/**
	 * Determines where the user is on the page.
	 * From http://github.com/hiddenloop/paging_keys_js/
	 * With some jQuery additions.
	 */
	whereAmI: function() {
		var st = $(window).scrollTop();
		var sl = $(window).scrollLeft();
		var sh = $(document).height();
		var ch = $(window).height();
		
		return {
			'top': st,
			'left': sl,
			'height': sh,
			'clientHeight': ch,
			'is_at_top': st == 0 && sl == 0,
			'is_at_last': st + ch == sh && sl == 0
		}
	}
	
};

/*!
 * jQuery scrollbarWidth - v0.2 - 2/11/2009
 * http://benalman.com/projects/jquery-misc-plugins/
 *
 * Copyright (c) 2010 "Cowboy" Ben Alman
 * Dual licensed under the MIT and GPL licenses.
 * http://benalman.com/about/license/
 */

// Calculate the scrollbar width dynamically!

(function($,undefined,width){
  '$:nomunge'; // Used by YUI compressor.

  $.scrollbarWidth = function() {
    var parent,
      child;

    if ( width === undefined ) {
      parent = $('<div style="width:50px;height:50px;overflow:auto"><div/></div>').appendTo('body');
      child = parent.children();
      width = child.innerWidth() - child.height( 99 ).innerWidth();
      parent.remove();
    }

    return width;
  };

})(jQuery);


/**
 * Copyright (c) 2007-2015 Ariel Flesler - aflesler<a>gmail<d>com | http://flesler.blogspot.com
 * Licensed under MIT
 * @author Ariel Flesler
 * @version 2.1.2
 */
;(function(f){"use strict";"function"===typeof define&&define.amd?define(["jquery"],f):"undefined"!==typeof module&&module.exports?module.exports=f(require("jquery")):f(jQuery)})(function($){"use strict";function n(a){return!a.nodeName||-1!==$.inArray(a.nodeName.toLowerCase(),["iframe","#document","html","body"])}function h(a){return $.isFunction(a)||$.isPlainObject(a)?a:{top:a,left:a}}var p=$.scrollTo=function(a,d,b){return $(window).scrollTo(a,d,b)};p.defaults={axis:"xy",duration:0,limit:!0};$.fn.scrollTo=function(a,d,b){"object"=== typeof d&&(b=d,d=0);"function"===typeof b&&(b={onAfter:b});"max"===a&&(a=9E9);b=$.extend({},p.defaults,b);d=d||b.duration;var u=b.queue&&1<b.axis.length;u&&(d/=2);b.offset=h(b.offset);b.over=h(b.over);return this.each(function(){function k(a){var k=$.extend({},b,{queue:!0,duration:d,complete:a&&function(){a.call(q,e,b)}});r.animate(f,k)}if(null!==a){var l=n(this),q=l?this.contentWindow||window:this,r=$(q),e=a,f={},t;switch(typeof e){case "number":case "string":if(/^([+-]=?)?\d+(\.\d+)?(px|%)?$/.test(e)){e= h(e);break}e=l?$(e):$(e,q);case "object":if(e.length===0)return;if(e.is||e.style)t=(e=$(e)).offset()}var v=$.isFunction(b.offset)&&b.offset(q,e)||b.offset;$.each(b.axis.split(""),function(a,c){var d="x"===c?"Left":"Top",m=d.toLowerCase(),g="scroll"+d,h=r[g](),n=p.max(q,c);t?(f[g]=t[m]+(l?0:h-r.offset()[m]),b.margin&&(f[g]-=parseInt(e.css("margin"+d),10)||0,f[g]-=parseInt(e.css("border"+d+"Width"),10)||0),f[g]+=v[m]||0,b.over[m]&&(f[g]+=e["x"===c?"width":"height"]()*b.over[m])):(d=e[m],f[g]=d.slice&& "%"===d.slice(-1)?parseFloat(d)/100*n:d);b.limit&&/^\d+$/.test(f[g])&&(f[g]=0>=f[g]?0:Math.min(f[g],n));!a&&1<b.axis.length&&(h===f[g]?f={}:u&&(k(b.onAfterFirst),f={}))});k(b.onAfter)}})};p.max=function(a,d){var b="x"===d?"Width":"Height",h="scroll"+b;if(!n(a))return a[h]-$(a)[b.toLowerCase()]();var b="client"+b,k=a.ownerDocument||a.document,l=k.documentElement,k=k.body;return Math.max(l[h],k[h])-Math.min(l[b],k[b])};$.Tween.propHooks.scrollLeft=$.Tween.propHooks.scrollTop={get:function(a){return $(a.elem)[a.prop]()}, set:function(a){var d=this.get(a);if(a.options.interrupt&&a._last&&a._last!==d)return $(a.elem).stop();var b=Math.round(a.now);d!==b&&($(a.elem)[a.prop](b),a._last=this.get(a))}};return p});


/*
 * jQuery Hotkeys Plugin
 * Copyright 2010, John Resig
 * Dual licensed under the MIT or GPL Version 2 licenses.
 *
 * Based upon the plugin by Tzury Bar Yochay:
 * https://github.com/tzuryby/jquery.hotkeys
 *
 * Original idea by:
 * Binny V A, http://www.openjs.com/scripts/events/keyboard_shortcuts/
 */
/*
 * One small change is: now keys are passed by object { keys: '...' }
 * Might be useful, when you want to pass some other data to your handler
 */
!function(t){function e(e){if("string"==typeof e.data&&(e.data={keys:e.data}),e.data&&e.data.keys&&"string"==typeof e.data.keys){var a=e.handler,s=e.data.keys.toLowerCase().split(" ");e.handler=function(e){if(this===e.target||!(t.hotkeys.options.filterInputAcceptingElements&&t.hotkeys.textInputTypes.test(e.target.nodeName)||t.hotkeys.options.filterContentEditable&&t(e.target).attr("contenteditable")||t.hotkeys.options.filterTextInputs&&t.inArray(e.target.type,t.hotkeys.textAcceptingInputTypes)>-1)){var n="keypress"!==e.type&&t.hotkeys.specialKeys[e.which],i=String.fromCharCode(e.which).toLowerCase(),r="",o={};t.each(["alt","ctrl","shift"],function(t,a){e[a+"Key"]&&n!==a&&(r+=a+"+")}),e.metaKey&&!e.ctrlKey&&"meta"!==n&&(r+="meta+"),e.metaKey&&"meta"!==n&&r.indexOf("alt+ctrl+shift+")>-1&&(r=r.replace("alt+ctrl+shift+","hyper+")),n?o[r+n]=!0:(o[r+i]=!0,o[r+t.hotkeys.shiftNums[i]]=!0,"shift+"===r&&(o[t.hotkeys.shiftNums[i]]=!0));for(var p=0,l=s.length;l>p;p++)if(o[s[p]])return a.apply(this,arguments)}}}}t.hotkeys={version:"0.2.0",specialKeys:{8:"backspace",9:"tab",10:"return",13:"return",16:"shift",17:"ctrl",18:"alt",19:"pause",20:"capslock",27:"esc",32:"space",33:"pageup",34:"pagedown",35:"end",36:"home",37:"left",38:"up",39:"right",40:"down",45:"insert",46:"del",59:";",61:"=",96:"0",97:"1",98:"2",99:"3",100:"4",101:"5",102:"6",103:"7",104:"8",105:"9",106:"*",107:"+",109:"-",110:".",111:"/",112:"f1",113:"f2",114:"f3",115:"f4",116:"f5",117:"f6",118:"f7",119:"f8",120:"f9",121:"f10",122:"f11",123:"f12",144:"numlock",145:"scroll",173:"-",186:";",187:"=",188:",",189:"-",190:".",191:"/",192:"`",219:"[",220:"\\",221:"]",222:"'"},shiftNums:{"`":"~",1:"!",2:"@",3:"#",4:"$",5:"%",6:"^",7:"&",8:"*",9:"(",0:")","-":"_","=":"+",";":": ","'":'"',",":"<",".":">","/":"?","\\":"|"},textAcceptingInputTypes:["text","password","number","email","url","range","date","month","week","time","datetime","datetime-local","search","color","tel"],textInputTypes:/textarea|input|select/i,options:{filterInputAcceptingElements:!0,filterTextInputs:!0,filterContentEditable:!0}},t.each(["keydown","keyup","keypress"],function(){t.event.special[this]={add:e}})}(jQuery||this.jQuery||window.jQuery);


/*
 * JSizes - JQuery plugin v0.33
 * http://www.bramstein.com/projects/jsizes/
 *
 * Licensed under the revised BSD License.
 * Copyright 2008-2010 Bram Stein
 * All rights reserved.
 */
(function(b){var a=function(c){return parseInt(c,10)||0};b.each(["min","max"],function(d,c){b.fn[c+"Size"]=function(g){var f,e;if(g){if(g.width!==undefined){this.css(c+"-width",g.width)}if(g.height!==undefined){this.css(c+"-height",g.height)}return this}else{f=this.css(c+"-width");e=this.css(c+"-height");return{width:(c==="max"&&(f===undefined||f==="none"||a(f)===-1)&&Number.MAX_VALUE)||a(f),height:(c==="max"&&(e===undefined||e==="none"||a(e)===-1)&&Number.MAX_VALUE)||a(e)}}}});b.fn.isVisible=function(){return this.is(":visible")};b.each(["border","margin","padding"],function(d,c){b.fn[c]=function(e){if(e){if(e.top!==undefined){this.css(c+"-top"+(c==="border"?"-width":""),e.top)}if(e.bottom!==undefined){this.css(c+"-bottom"+(c==="border"?"-width":""),e.bottom)}if(e.left!==undefined){this.css(c+"-left"+(c==="border"?"-width":""),e.left)}if(e.right!==undefined){this.css(c+"-right"+(c==="border"?"-width":""),e.right)}return this}else{return{top:a(this.css(c+"-top"+(c==="border"?"-width":""))),bottom:a(this.css(c+"-bottom"+(c==="border"?"-width":""))),left:a(this.css(c+"-left"+(c==="border"?"-width":""))),right:a(this.css(c+"-right"+(c==="border"?"-width":"")))}}}})})(jQuery);

/*!
 * JavaScript Cookie v2.0.4
 * https://github.com/js-cookie/js-cookie
 *
 * Copyright 2006, 2015 Klaus Hartl & Fagner Brack
 * Released under the MIT license
 */
!function(e){if("function"==typeof define&&define.amd)define(e);else if("object"==typeof exports)module.exports=e();else{var n=window.Cookies,t=window.Cookies=e();t.noConflict=function(){return window.Cookies=n,t}}}(function(){function e(){for(var e=0,n={};e<arguments.length;e++){var t=arguments[e];for(var o in t)n[o]=t[o]}return n}function n(t){function o(n,r,i){var c;if(arguments.length>1){if(i=e({path:"/"},o.defaults,i),"number"==typeof i.expires){var s=new Date;s.setMilliseconds(s.getMilliseconds()+864e5*i.expires),i.expires=s}try{c=JSON.stringify(r),/^[\{\[]/.test(c)&&(r=c)}catch(a){}return r=t.write?t.write(r,n):encodeURIComponent(String(r)).replace(/%(23|24|26|2B|3A|3C|3E|3D|2F|3F|40|5B|5D|5E|60|7B|7D|7C)/g,decodeURIComponent),n=encodeURIComponent(String(n)),n=n.replace(/%(23|24|26|2B|5E|60|7C)/g,decodeURIComponent),n=n.replace(/[\(\)]/g,escape),document.cookie=[n,"=",r,i.expires&&"; expires="+i.expires.toUTCString(),i.path&&"; path="+i.path,i.domain&&"; domain="+i.domain,i.secure?"; secure":""].join("")}n||(c={});for(var p=document.cookie?document.cookie.split("; "):[],d=/(%[0-9A-Z]{2})+/g,u=0;u<p.length;u++){var f=p[u].split("="),l=f[0].replace(d,decodeURIComponent),m=f.slice(1).join("=");'"'===m.charAt(0)&&(m=m.slice(1,-1));try{if(m=t.read?t.read(m,l):t(m,l)||m.replace(d,decodeURIComponent),this.json)try{m=JSON.parse(m)}catch(a){}if(n===l){c=m;break}n||(c[l]=m)}catch(a){}}return c}return o.get=o.set=o,o.getJSON=function(){return o.apply({json:!0},[].slice.call(arguments))},o.defaults={},o.remove=function(n,t){o(n,"",e(t,{expires:-1}))},o.withConverter=n,o}return n(function(){})});


/*! jquery.livequery - v1.3.6 - 2013-08-26
 * Copyright (c)
 *  (c) 2010, Brandon Aaron (http://brandonaaron.net)
 *  (c) 2012 - 2013, Alexander Zaytsev (http://hazzik.ru/en)
 * Dual licensed under the MIT (MIT_LICENSE.txt)
 * and GPL Version 2 (GPL_LICENSE.txt) licenses.
 */
!function(a){"function"==typeof define&&define.amd?define(["jquery"],a):"object"==typeof exports?a(require("jquery")):a(jQuery)}(function(a,b){function c(a,b,c,d){return!(a.selector!=b.selector||a.context!=b.context||c&&c.$lqguid!=b.fn.$lqguid||d&&d.$lqguid!=b.fn2.$lqguid)}a.extend(a.fn,{livequery:function(b,e){var f,g=this;return a.each(d.queries,function(a,d){return c(g,d,b,e)?(f=d)&&!1:void 0}),f=f||new d(g.selector,g.context,b,e),f.stopped=!1,f.run(),g},expire:function(b,e){var f=this;return a.each(d.queries,function(a,g){c(f,g,b,e)&&!f.stopped&&d.stop(g.id)}),f}});var d=a.livequery=function(b,c,e,f){var g=this;return g.selector=b,g.context=c,g.fn=e,g.fn2=f,g.elements=a([]),g.stopped=!1,g.id=d.queries.push(g)-1,e.$lqguid=e.$lqguid||d.guid++,f&&(f.$lqguid=f.$lqguid||d.guid++),g};d.prototype={stop:function(){var b=this;b.stopped||(b.fn2&&b.elements.each(b.fn2),b.elements=a([]),b.stopped=!0)},run:function(){var b=this;if(!b.stopped){var c=b.elements,d=a(b.selector,b.context),e=d.not(c),f=c.not(d);b.elements=d,e.each(b.fn),b.fn2&&f.each(b.fn2)}}},a.extend(d,{guid:0,queries:[],queue:[],running:!1,timeout:null,registered:[],checkQueue:function(){if(d.running&&d.queue.length)for(var a=d.queue.length;a--;)d.queries[d.queue.shift()].run()},pause:function(){d.running=!1},play:function(){d.running=!0,d.run()},registerPlugin:function(){a.each(arguments,function(b,c){if(a.fn[c]&&!(a.inArray(c,d.registered)>0)){var e=a.fn[c];a.fn[c]=function(){var a=e.apply(this,arguments);return d.run(),a},d.registered.push(c)}})},run:function(c){c!==b?a.inArray(c,d.queue)<0&&d.queue.push(c):a.each(d.queries,function(b){a.inArray(b,d.queue)<0&&d.queue.push(b)}),d.timeout&&clearTimeout(d.timeout),d.timeout=setTimeout(d.checkQueue,20)},stop:function(c){c!==b?d.queries[c].stop():a.each(d.queries,d.prototype.stop)}}),d.registerPlugin("append","prepend","after","before","wrap","attr","removeAttr","addClass","removeClass","toggleClass","empty","remove","html","prop","removeProp"),a(function(){d.play()})});

