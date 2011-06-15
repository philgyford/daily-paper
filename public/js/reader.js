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
 * The custom code for the main functionality of the site.
 */
var reader = {
	
	// Will be of the form YYYY-MM-DD.
	issueDate: '',
	
	// Will be data from the Contents File.
	issueContents: {},
	
	// This will be a list of the data about each article file, in order.
	// Each has keys of: file, path, title, words, id.
	issueArticles: [],
	
	// Will map the Guardian's article IDs to the 1-based index of the articles in reader.issueArticles.
	// eg, 'world/2010/jul/08/gay/clergyman-jeffrey-john-bishop' => 3
	issueArticleIds: {},
	
	// Will be the 1-based index of the currently-viewed file in reader.issueArticles.
	// Begins on 0 until we view a page.
	currentPos: 0,
	
	// Will be the 1-based index of the current section, as used in #progress.
	currentSection: 1,
	
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
	 * User clicked one of the progress sections at the top of the page.
	 * So we need to jump to the first article in that section.
	 * section is the section number, eg from <div id="progress-1">, it's the 1.
	 */
	changeSection: function(section) {
		// Get the CSS ID of the first li in this section, eg 'progress-item-131'
		var firstArticleId = $('#progress-'+section).find('li').first().attr('id');
		// Get the index of the article to jump to, eg 131.
		var idx = parseInt( firstArticleId.substr(firstArticleId.lastIndexOf('-')+1) );
		
		reader.moveToArticle(idx);
		reader.currentSection = section;
	},
	
	
	/**
	 * Sets a cookie containing this issue's date and the Guardian ID of the article we're currently looking at.
	 */
	cookieSet: function() {
		// The 'position' is the ID of the article, like 'law/2010/jul/07/torture-inquiry-witnesses-peter-gibson'.
		var cookieText = 'date:' + reader.issueDate + ':::position:' + reader.issueArticles[reader.currentPos-1]['id'];
		
		$.cookie('guardian', cookieText, { expires: 2 });
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
		// Keep track of what's int he process of glowing, so we don't store up
		// multiple glows.
		var in_speed = 300;
		var delay_speed = 1000;
		var out_speed = 1500;
		if (speed == 'fast') {
			delay_speed = 0;
			out_speed = 1000;
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
			deltaX = first.pageX - startX;
			deltaY = first.pageY - startY;
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

		if (reader.hasTouch) {
			// iPhone etc.
			$('div#page-'+initialArticleIdx+' div.body').livequery(function(){
				// For some reason the first article doesn't finish loading
				// when resizePage() is first called on iPad etc, so we call it
				// again once we know things have loaded.
				reader.resizePage();
			});
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

			if (reader.isIOS) {
				// Stupid fix for iOS's inability to implement position:fixed.
				// Also in moveToArticleAfter().
				var adjustNextPrev = function(){
					$('#next,#prev').css({top: window.pageYOffset + 'px'}).height($(window).height());
				};
				$(window).scroll(adjustNextPrev).load(function(){
					// The page might (re)load and jump immediately to part-way
					// down. So need to adjust nextprev as if scrolled.
					// But without the setTimeout it doesn't happen.
					setTimeout(adjustNextPrev, 500);
				});
			};
		};

		// Make the nav appear briefly where available.
		if (initialArticleIdx == 1) {
			// First article.
			reader.glowNav('next', 'normal');
		} else if (initialArticleIdx == reader.issueArticles.length) {
			// Last article.
			reader.glowNav('prev', 'normal');
		} else { 
			reader.glowNav('next', 'normal');
			reader.glowNav('prev', 'normal');
		};

		// Set the next/prev links and main content position to change if we 
		// resize the window.
		$(window).resize(function(){
			reader.resizePage();
		});

		// Set up the next/prev buttons to go to the next/prev story, but only if
		// they're 'on'.
		// They're not 'on' when at the beginning or end of the articles as
		// appropriate.
		$('.off#next').live('click', function(){return false;});
		$('.on#next').live('click', function(){
			if (reader.hasTouch) {
				reader.glowNav('next', 'fast');
			};
			reader.articleNext();
			return false;
		});
		$('.off#prev').live('click', function(){return false;});
		$('.on#prev').live('click', function(){
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
	},


	/**
	 * When page is initialized, and whenever we open a modal dialog.
	 */
	enableKeyboardShortcuts: function() {
		$(document).bind('keydown', 'd', function(){ reader.articleNext(); });
		$(document).bind('keydown', 'shift+d', function(){ reader.sectionNext(); });
		$(document).bind('keydown', 'l', function(){ reader.articleNext(); });
		$(document).bind('keydown', 'shift+l', function(){ reader.sectionNext(); });
		$(document).bind('keydown', 'right', function(){ reader.articleNext(); });
		$(document).bind('keydown', 'shift+right', function(){ reader.sectionNext(); });
		
		$(document).bind('keydown', 'a', function(){ reader.articlePrev(); });
		$(document).bind('keydown', 'shift+a', function(){ reader.sectionPrev(); });
		$(document).bind('keydown', 'h', function(){ reader.articlePrev(); });
		$(document).bind('keydown', 'shift+h', function(){ reader.sectionPrev(); });
		$(document).bind('keydown', 'left', function(){ reader.articlePrev(); });
		$(document).bind('keydown', 'shift+left', function(){ reader.sectionPrev(); });
		
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

		var cookieText = $.cookie('guardian');
		
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
					$.cookie('guardian', null);
				}
			} else {
				// Cookie is for a previous issue of the paper, so we won't need it any more. Unset it.
				$.cookie('guardian', null);
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
			var scrollSpeed = p.clientHeight / 2;
			
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
			
			if (typeof WebKitTransitionEvent == "object") {
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
		
		// Get the ID (like 'progress-2') of the section this article is in.
		var sectionTextId = $('#progress-item-'+reader.currentPos).parent().parent().attr('id');
		// Set the currentSection to the numeric ID of the section.
		reader.currentSection = parseInt(sectionTextId.substr(sectionTextId.lastIndexOf('-')+1));

		$('#progress-'+reader.currentSection).addClass('on');
		$('#progress-item-'+reader.currentPos).addClass('on');
		
		// Set the height of the window to the height of the article we're now viewing.
		$('#window').height($('#page-'+reader.currentPos).height());
		
		// In case scrollbars have appeared/disappeared and changed page width.
		reader.resizePage();

		if (reader.isIOS) {
			// Stupid fix for iOS's inability to implement position:fixed.
			// Also in initializePage().
			$('#next,#prev').css({top: window.pageYOffset + 'px'}).height($(window).height());
		};

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
		var url = 'http://www.guardian.co.uk' + reader.issueArticles[reader.currentPos-1]['path'];
		window.open(url);
		return false;
	},

	
	/**
	 * Creates the progress stuff - the markers across the top of the page.
	 * ALSO: Creates all the empty <div class="page">'s which will contain the article text.
	 */
	processContents: function() {
		$.each(reader.issueContents.sections, function(n, section) {
			
			// Make a <div> to hold the progress markers for each section.
			$progressDiv = $('<div/>').attr({
				'id': 'progress-'+(n+1)
			}).html('<span>'+section.meta.title+'</span>').click(function(){
				reader.changeSection(n+1);
			});
			
			// And this <ol> will go within that div.
			$progressList = $('<ol/>');
			
			$.each(section.links, function(m, link) {
				// Go through each article in this section and add to the progress
				// and contents.

				// Add this one to the list of articles.
				reader.issueArticles.push(link);
				
				// Map the Guardian's long IDs to the position of this article in
				// reader.issueArticles.
				reader.issueArticleIds[link.id] = reader.issueArticles.length;
				
				var lengthPercent = Math.round((link.words / reader.issueContents.meta.max_words) * 100);
				
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
					// If we don't, then when we jump to a new section we seem to
					// get the wrong page.
					$('<div/>').addClass(className).attr({id:'page-'+reader.issueArticles.length}).html('&nbsp;')
				);
			});
			
			$('#progress').append($progressDiv.append($progressList));
		});

		var progressWidth = 0;
		$('#progress div').each(function(n) {
			progressWidth += $(this).outerWidth() + $(this).margin().left + $(this).margin().right;
		});
		// If the progress bar spans more than one row, we indicate it should
		// be in compact format. (See CSS.)
		if ($('#progress').innerWidth() < progressWidth) {
			$('#progress').addClass('compact');
		};
		
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
			$('div.body').width( $('div#window').innerWidth() );
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

		$('#window').height($('div.current').height());

		if ($('#about-page:visible').exists()) {
			reader.setAboutSize();
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
		if ($.browser.msie) {
			if(parseInt($.browser.version) == 7) {
				viewportHeight -= 3;
			};
		};
					   
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
		};
	},
	
	
	/**
	 * Jump ahead one section.
	 */
	sectionNext: function() { 
		var sectionToMoveTo = reader.currentSection + 1;
		if ($('#progress-'+sectionToMoveTo).exists()) {
			reader.changeSection(sectionToMoveTo);
		}
	},
	
	
	/**
	 * Jump back one section.
	 * (Or to start of current section if we're not already at the start of it.)
	 */
	sectionPrev: function() {
		// Chances are we're just moving to the first article in the current section.
		var sectionToMoveTo = reader.currentSection;
		
		// Get CSS ID of the first article in the section before the current one.
		var firstArticleId = $('#progress-'+reader.currentSection).find('li').first().attr('id');
		// Get the index of the article to jump to, eg 131.
		var firstArticleIdx = parseInt( firstArticleId.substr(firstArticleId.lastIndexOf('-')+1) );
		
		// But, if we're on the first article of this section, jump back to the previous ection.
		if (reader.currentPos == firstArticleIdx) {
			sectionToMoveTo = reader.currentSection - 1;
		}
		
		if ($('#progress-'+sectionToMoveTo).exists()) {
			reader.changeSection(sectionToMoveTo);
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
 * jQuery.ScrollTo - Easy element scrolling using jQuery.
 * Copyright (c) 2007-2009 Ariel Flesler - aflesler(at)gmail(dot)com | http://flesler.blogspot.com
 * Dual licensed under MIT and GPL.
 * Date: 5/25/2009
 * @author Ariel Flesler
 * @version 1.4.2
 *
 * http://flesler.blogspot.com/2007/10/jqueryscrollto.html
 */
;(function(d){var k=d.scrollTo=function(a,i,e){d(window).scrollTo(a,i,e)};k.defaults={axis:'xy',duration:parseFloat(d.fn.jquery)>=1.3?0:1};k.window=function(a){return d(window)._scrollable()};d.fn._scrollable=function(){return this.map(function(){var a=this,i=!a.nodeName||d.inArray(a.nodeName.toLowerCase(),['iframe','#document','html','body'])!=-1;if(!i)return a;var e=(a.contentWindow||a).document||a.ownerDocument||a;return d.browser.safari||e.compatMode=='BackCompat'?e.body:e.documentElement})};d.fn.scrollTo=function(n,j,b){if(typeof j=='object'){b=j;j=0}if(typeof b=='function')b={onAfter:b};if(n=='max')n=9e9;b=d.extend({},k.defaults,b);j=j||b.speed||b.duration;b.queue=b.queue&&b.axis.length>1;if(b.queue)j/=2;b.offset=p(b.offset);b.over=p(b.over);return this._scrollable().each(function(){var q=this,r=d(q),f=n,s,g={},u=r.is('html,body');switch(typeof f){case'number':case'string':if(/^([+-]=)?\d+(\.\d+)?(px|%)?$/.test(f)){f=p(f);break}f=d(f,this);case'object':if(f.is||f.style)s=(f=d(f)).offset()}d.each(b.axis.split(''),function(a,i){var e=i=='x'?'Left':'Top',h=e.toLowerCase(),c='scroll'+e,l=q[c],m=k.max(q,i);if(s){g[c]=s[h]+(u?0:l-r.offset()[h]);if(b.margin){g[c]-=parseInt(f.css('margin'+e))||0;g[c]-=parseInt(f.css('border'+e+'Width'))||0}g[c]+=b.offset[h]||0;if(b.over[h])g[c]+=f[i=='x'?'width':'height']()*b.over[h]}else{var o=f[h];g[c]=o.slice&&o.slice(-1)=='%'?parseFloat(o)/100*m:o}if(/^\d+$/.test(g[c]))g[c]=g[c]<=0?0:Math.min(g[c],m);if(!a&&b.queue){if(l!=g[c])t(b.onAfterFirst);delete g[c]}});t(b.onAfter);function t(a){r.animate(g,j,b.easing,a&&function(){a.call(this,n,b)})}}).end()};k.max=function(a,i){var e=i=='x'?'Width':'Height',h='scroll'+e;if(!d(a).is('html,body'))return a[h]-d(a)[e.toLowerCase()]();var c='client'+e,l=a.ownerDocument.documentElement,m=a.ownerDocument.body;return Math.max(l[h],m[h])-Math.min(l[c],m[c])};function p(a){return typeof a=='object'?a:{top:a,left:a}}})(jQuery);


/*
 * jQuery Hotkeys Plugin
 * Copyright 2010, John Resig
 * Dual licensed under the MIT or GPL Version 2 licenses.
 *
 * From http://github.com/jeresig/jquery.hotkeys
 *
 * Based upon the plugin by Tzury Bar Yochay:
 * http://github.com/tzuryby/hotkeys
 *
 * Original idea by:
 * Binny V A, http://www.openjs.com/scripts/events/keyboard_shortcuts/
*/
(function(jQuery){

	jQuery.hotkeys = {
		version: "0.8",

		specialKeys: {
			8: "backspace", 9: "tab", 13: "return", 16: "shift", 17: "ctrl", 18: "alt", 19: "pause",
			20: "capslock", 27: "esc", 32: "space", 33: "pageup", 34: "pagedown", 35: "end", 36: "home",
			37: "left", 38: "up", 39: "right", 40: "down", 45: "insert", 46: "del", 
			96: "0", 97: "1", 98: "2", 99: "3", 100: "4", 101: "5", 102: "6", 103: "7",
			104: "8", 105: "9", 106: "*", 107: "+", 109: "-", 110: ".", 111 : "/", 
			112: "f1", 113: "f2", 114: "f3", 115: "f4", 116: "f5", 117: "f6", 118: "f7", 119: "f8", 
			120: "f9", 121: "f10", 122: "f11", 123: "f12", 144: "numlock", 145: "scroll", 191: "/", 224: "meta"
		},

		shiftNums: {
			"`": "~", "1": "!", "2": "@", "3": "#", "4": "$", "5": "%", "6": "^", "7": "&", 
			"8": "*", "9": "(", "0": ")", "-": "_", "=": "+", ";": ": ", "'": "\"", ",": "<", 
			".": ">",  "/": "?",  "\\": "|"
		}
	};

	function keyHandler( handleObj ) {
		// Only care when a possible input has been specified
		if ( typeof handleObj.data !== "string" ) {
			return;
		}

		var origHandler = handleObj.handler,
			keys = handleObj.data.toLowerCase().split(" ");

		handleObj.handler = function( event ) {
			// Don't fire in text-accepting inputs that we didn't directly bind to
			if ( this !== event.target && (/textarea|select/i.test( event.target.nodeName ) ||
				 event.target.type === "text") ) {
				return;
			}

			// Keypress represents characters, not special keys
			var special = event.type !== "keypress" && jQuery.hotkeys.specialKeys[ event.which ],
				character = String.fromCharCode( event.which ).toLowerCase(),
				key, modif = "", possible = {};

			// check combinations (alt|ctrl|shift+anything)
			if ( event.altKey && special !== "alt" ) {
				modif += "alt+";
			}

			if ( event.ctrlKey && special !== "ctrl" ) {
				modif += "ctrl+";
			}

			// TODO: Need to make sure this works consistently across platforms
			if ( event.metaKey && !event.ctrlKey && special !== "meta" ) {
				modif += "meta+";
			}

			if ( event.shiftKey && special !== "shift" ) {
				modif += "shift+";
			}

			if ( special ) {
				possible[ modif + special ] = true;

			} else {
				possible[ modif + character ] = true;
				possible[ modif + jQuery.hotkeys.shiftNums[ character ] ] = true;

				// "$" can be triggered as "Shift+4" or "Shift+$" or just "$"
				if ( modif === "shift+" ) {
					possible[ jQuery.hotkeys.shiftNums[ character ] ] = true;
				}
			}

			for ( var i = 0, l = keys.length; i < l; i++ ) {
				if ( possible[ keys[i] ] ) {
					return origHandler.apply( this, arguments );
				}
			}
		};
	}

	jQuery.each([ "keydown", "keyup", "keypress" ], function() {
		jQuery.event.special[ this ] = { add: keyHandler };
	});

})( jQuery );


/*
 * JSizes - JQuery plugin v0.33
 * http://www.bramstein.com/projects/jsizes/
 *
 * Licensed under the revised BSD License.
 * Copyright 2008-2010 Bram Stein
 * All rights reserved.
 */
(function(b){var a=function(c){return parseInt(c,10)||0};b.each(["min","max"],function(d,c){b.fn[c+"Size"]=function(g){var f,e;if(g){if(g.width!==undefined){this.css(c+"-width",g.width)}if(g.height!==undefined){this.css(c+"-height",g.height)}return this}else{f=this.css(c+"-width");e=this.css(c+"-height");return{width:(c==="max"&&(f===undefined||f==="none"||a(f)===-1)&&Number.MAX_VALUE)||a(f),height:(c==="max"&&(e===undefined||e==="none"||a(e)===-1)&&Number.MAX_VALUE)||a(e)}}}});b.fn.isVisible=function(){return this.is(":visible")};b.each(["border","margin","padding"],function(d,c){b.fn[c]=function(e){if(e){if(e.top!==undefined){this.css(c+"-top"+(c==="border"?"-width":""),e.top)}if(e.bottom!==undefined){this.css(c+"-bottom"+(c==="border"?"-width":""),e.bottom)}if(e.left!==undefined){this.css(c+"-left"+(c==="border"?"-width":""),e.left)}if(e.right!==undefined){this.css(c+"-right"+(c==="border"?"-width":""),e.right)}return this}else{return{top:a(this.css(c+"-top"+(c==="border"?"-width":""))),bottom:a(this.css(c+"-bottom"+(c==="border"?"-width":""))),left:a(this.css(c+"-left"+(c==="border"?"-width":""))),right:a(this.css(c+"-right"+(c==="border"?"-width":"")))}}}})})(jQuery);



/**
 * Cookie plugin
 *
 * Copyright (c) 2006 Klaus Hartl (stilbuero.de)
 * Dual licensed under the MIT and GPL licenses:
 * http://www.opensource.org/licenses/mit-license.php
 * http://www.gnu.org/licenses/gpl.html
 *
 */


/**
 * Create a cookie with the given name and value and other optional parameters.
 *
 * @example $.cookie('the_cookie', 'the_value');
 * @desc Set the value of a cookie.
 * @example $.cookie('the_cookie', 'the_value', { expires: 7, path: '/', domain: 'jquery.com', secure: true });
 * @desc Create a cookie with all available options.
 * @example $.cookie('the_cookie', 'the_value');
 * @desc Create a session cookie.
 * @example $.cookie('the_cookie', null);
 * @desc Delete a cookie by passing null as value. Keep in mind that you have to use the same path and domain
 *       used when the cookie was set.
 *
 * @param String name The name of the cookie.
 * @param String value The value of the cookie.
 * @param Object options An object literal containing key/value pairs to provide optional cookie attributes.
 * @option Number|Date expires Either an integer specifying the expiration date from now on in days or a Date object.
 *                             If a negative value is specified (e.g. a date in the past), the cookie will be deleted.
 *                             If set to null or omitted, the cookie will be a session cookie and will not be retained
 *                             when the the browser exits.
 * @option String path The value of the path atribute of the cookie (default: path of page that created the cookie).
 * @option String domain The value of the domain attribute of the cookie (default: domain of page that created the cookie).
 * @option Boolean secure If true, the secure attribute of the cookie will be set and the cookie transmission will
 *                        require a secure protocol (like HTTPS).
 * @type undefined
 *
 * @name $.cookie
 * @cat Plugins/Cookie
 * @author Klaus Hartl/klaus.hartl@stilbuero.de
 */

/**
 * Get the value of a cookie with the given name.
 *
 * @example $.cookie('the_cookie');
 * @desc Get the value of a cookie.
 *
 * @param String name The name of the cookie.
 * @return The value of the cookie.
 * @type String
 *
 * @name $.cookie
 * @cat Plugins/Cookie
 * @author Klaus Hartl/klaus.hartl@stilbuero.de
 */
jQuery.cookie = function(name, value, options) {
    if (typeof value != 'undefined') { // name and value given, set cookie
        options = options || {};
        if (value === null) {
            value = '';
            options.expires = -1;
        }
        var expires = '';
        if (options.expires && (typeof options.expires == 'number' || options.expires.toUTCString)) {
            var date;
            if (typeof options.expires == 'number') {
                date = new Date();
                date.setTime(date.getTime() + (options.expires * 24 * 60 * 60 * 1000));
            } else {
                date = options.expires;
            }
            expires = '; expires=' + date.toUTCString(); // use expires attribute, max-age is not supported by IE
        }
        // CAUTION: Needed to parenthesize options.path and options.domain
        // in the following expressions, otherwise they evaluate to undefined
        // in the packed version for some reason...
        var path = options.path ? '; path=' + (options.path) : '';
        var domain = options.domain ? '; domain=' + (options.domain) : '';
        var secure = options.secure ? '; secure' : '';
        document.cookie = [name, '=', encodeURIComponent(value), expires, path, domain, secure].join('');
    } else { // only name given, get cookie
        var cookieValue = null;
        if (document.cookie && document.cookie != '') {
            var cookies = document.cookie.split(';');
            for (var i = 0; i < cookies.length; i++) {
                var cookie = jQuery.trim(cookies[i]);
                // Does this cookie string begin with the name we want?
                if (cookie.substring(0, name.length + 1) == (name + '=')) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue;
    }
};

/* Copyright (c) 2010 Brandon Aaron (http://brandonaaron.net)
 * Dual licensed under the MIT (MIT_LICENSE.txt)
 * and GPL Version 2 (GPL_LICENSE.txt) licenses.
 *
 * Version: 1.1.1
 * Requires jQuery 1.3+
 * Docs: http://docs.jquery.com/Plugins/livequery
 */
(function(a){a.extend(a.fn,{livequery:function(e,d,c){var b=this,f;if(a.isFunction(e)){c=d,d=e,e=undefined}a.each(a.livequery.queries,function(g,h){if(b.selector==h.selector&&b.context==h.context&&e==h.type&&(!d||d.$lqguid==h.fn.$lqguid)&&(!c||c.$lqguid==h.fn2.$lqguid)){return(f=h)&&false}});f=f||new a.livequery(this.selector,this.context,e,d,c);f.stopped=false;f.run();return this},expire:function(e,d,c){var b=this;if(a.isFunction(e)){c=d,d=e,e=undefined}a.each(a.livequery.queries,function(f,g){if(b.selector==g.selector&&b.context==g.context&&(!e||e==g.type)&&(!d||d.$lqguid==g.fn.$lqguid)&&(!c||c.$lqguid==g.fn2.$lqguid)&&!this.stopped){a.livequery.stop(g.id)}});return this}});a.livequery=function(b,d,f,e,c){this.selector=b;this.context=d;this.type=f;this.fn=e;this.fn2=c;this.elements=[];this.stopped=false;this.id=a.livequery.queries.push(this)-1;e.$lqguid=e.$lqguid||a.livequery.guid++;if(c){c.$lqguid=c.$lqguid||a.livequery.guid++}return this};a.livequery.prototype={stop:function(){var b=this;if(this.type){this.elements.unbind(this.type,this.fn)}else{if(this.fn2){this.elements.each(function(c,d){b.fn2.apply(d)})}}this.elements=[];this.stopped=true},run:function(){if(this.stopped){return}var d=this;var e=this.elements,c=a(this.selector,this.context),b=c.not(e);this.elements=c;if(this.type){b.bind(this.type,this.fn);if(e.length>0){a.each(e,function(f,g){if(a.inArray(g,c)<0){a.event.remove(g,d.type,d.fn)}})}}else{b.each(function(){d.fn.apply(this)});if(this.fn2&&e.length>0){a.each(e,function(f,g){if(a.inArray(g,c)<0){d.fn2.apply(g)}})}}}};a.extend(a.livequery,{guid:0,queries:[],queue:[],running:false,timeout:null,checkQueue:function(){if(a.livequery.running&&a.livequery.queue.length){var b=a.livequery.queue.length;while(b--){a.livequery.queries[a.livequery.queue.shift()].run()}}},pause:function(){a.livequery.running=false},play:function(){a.livequery.running=true;a.livequery.run()},registerPlugin:function(){a.each(arguments,function(c,d){if(!a.fn[d]){return}var b=a.fn[d];a.fn[d]=function(){var e=b.apply(this,arguments);a.livequery.run();return e}})},run:function(b){if(b!=undefined){if(a.inArray(b,a.livequery.queue)<0){a.livequery.queue.push(b)}}else{a.each(a.livequery.queries,function(c){if(a.inArray(c,a.livequery.queue)<0){a.livequery.queue.push(c)}})}if(a.livequery.timeout){clearTimeout(a.livequery.timeout)}a.livequery.timeout=setTimeout(a.livequery.checkQueue,20)},stop:function(b){if(b!=undefined){a.livequery.queries[b].stop()}else{a.each(a.livequery.queries,function(c){a.livequery.queries[c].stop()})}}});a.livequery.registerPlugin("append","prepend","after","before","wrap","attr","removeAttr","addClass","removeClass","toggleClass","empty","remove","html");a(function(){a.livequery.play()})})(jQuery);
