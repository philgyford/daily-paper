#!/usr/bin/env python
import configparser
import datetime
import dateutil.parser
import hashlib
from jinja2 import Environment, PackageLoader
import json
import os
import pytz
import requests
import shutil
import signal
import sys
import time
from typogrify.templatetags import jinja_filters
import warnings


class GuardianGrabber:
    def __init__(self):

        self.load_config()

    def load_config(self):
        "Sets initial object variables, and loads others from the scraper.cfg file"

        # First, variables which are set here, not in the config file.

        # The array used to create the contents.json once all processin's done:
        #
        # {
        #     'meta': {
        #         'max_words': 2340,
        #         'paper_name': 'observer'
        #     },
        #     'books': [
        #         {
        #             'meta': {
        #                   'id': '',
        #                   'webUrl': 'http...',
        #                   'webTitle':'Main section',
        #                   ...},
        #             'articles': [{
        #                   'id': 'world/gallery/2010/jul/07/spain-spain',
        #                   'path': '/world/gallery/2010/jul/07/spain-spain',
        #                   'title': 'Article title...',
        #                   'file': 'spain-spain.html',
        #                   'words': 374,
        #                   'newspaperPageNumber': 34,
        #                   'newspaperBookSection': {'id':'','title':'', ...}
        #               }, {}, {}]
        #         },
        #         {}
        #     ]
        # }
        self.contents = {"meta": {"max_words": 0}, "books": []}

        # Temporary place for what will go in self.contents['books'].
        # In this case it's structured like:
        # {
        #   'theguardian/sport': {
        #       'meta': {...},
        #       'articles': [{...}, {...}, ...],
        #   },
        #   ...
        # }
        #
        # Then, after fetching we'll put all the values from this into
        # self.contents['books'] in the correct order.
        self.fetched_books = {}

        # Will be set depending on what issue we're fetching.
        # A datetime object.
        self.issue_date = None

        # Will be set in start() to a path of self.archive_dir plus
        # self.issue_date
        self.issue_archive_dir = ""

        # The URLs of the full list of the current issue of the Guardian and
        # Observer.
        self.source_urls = {
            "guardian": "http://www.theguardian.com/theguardian",
            "observer": "http://www.theguardian.com/theobserver",
        }

        # When we've worked out what date we're on, this will be either
        # 'guardian' or 'observer'.
        self.paper_name = ""

        # Will be the lockfile we check to make sure this script doesn't run
        # multiple times.
        self.lockfile_path = sys.path[0] + "/lock.pid"

        # Second, load stuff from the config file.

        config_file = sys.path[0] + "/scraper.cfg"
        config = configparser.ConfigParser()

        try:
            config.read_file(open(config_file))
        except IOError:
            raise ScraperError("Can't read config file: " + config_file)

        self.guardian_api_key = config.get("Settings", "guardian_api_key")

        self.archive_dir = config.get("Settings", "archive_dir")

        self.verbose = config.getboolean("Settings", "verbose")

        # Set up the template we'll use to render each article to a file.
        jinja_env = Environment(loader=PackageLoader("scraper", "../templates"))
        jinja_env.filters["typogrify"] = jinja_filters.typogrify
        self.template = jinja_env.get_template("article.html")

    def checkForOldProcesses(self):
        """
        Checks the lockfile to see if there's an older process running.
        If so, tries to kill it and deletes the lockfile.
        """
        if os.access(self.lockfile_path, os.F_OK):
            # If the file is there, check the PID number.
            lockfile = open(self.lockfile_path, "r")
            lockfile.seek(0)
            old_pid = lockfile.readline()
            if old_pid:
                try:
                    # Doesn't kill it, but checks to see if the pid exists.
                    os.kill(int(old_pid), 0)
                    try:
                        os.kill(int(old_pid), signal.SIGQUIT)
                        self.removeLockfile
                        warnings.warn(
                            "Lockfile found ("
                            + self.lockfile_path
                            + "). An instance of this program was already running "
                            + "as process "
                            + old_pid
                            + " but it was killed. Continuing"
                        )
                    except OSError:
                        # Couldn't kill it. Quit.
                        raise ScraperError(
                            (
                                "Lockfile found (%s).\nAn instance of this program is "
                                "already running as process %s but it could not be "
                                "killed.\nExiting."
                            )
                            % (self.lockfile_path, old_pid)
                        )
                except OSError:
                    # Process not running. Just delete file.
                    self.removeLockfile
            else:
                warnings.warn(
                    "Lockfile found ("
                    + self.lockfile_path
                    + ") but it did not contain a PID. Deleting it and continuing."
                )

    def makeLockfile(self):
        """
        Create a file to show this script is running.
        """
        lockfile = open(self.lockfile_path, "w")
        lockfile.write("%s" % os.getpid())
        lockfile.close()

    def removeLockfile(self):
        os.remove(self.lockfile_path)

    def start(self):
        """
        The main action. Fetches all of the required data for today's paper and
        saves it locally.
        """
        self.checkForOldProcesses()
        self.makeLockfile()

        # Sets the date and paper (guardian or observer).
        self.set_issue_date()

        if self.issue_date != "":
            self.issue_archive_dir = (
                self.archive_dir + self.issue_date.strftime("%Y-%m-%d") + "/"
            )
        else:
            raise ScraperError(
                "We don't have an issue date, so can't make an archive directory."
            )

        # Make the directory we'll save the HTML files in.
        if not os.path.exists(self.issue_archive_dir):
            os.makedirs(self.issue_archive_dir)

        # Get all of today's articles and save HTML versions to disk.
        self.fetch_articles()

        self.sort_articles()

        # Delete the day-before-yesterday's files.
        # (Not yesterday's, just in case someone is currently viewing them.)
        old_date = self.issue_date - datetime.timedelta(2)
        old_dir = self.archive_dir + old_date.strftime("%Y-%m-%d")
        if os.path.exists(old_dir):
            shutil.rmtree(old_dir)

        # Write all the information about this issue to a contents.json file
        # within the dated folder.
        try:
            with open(self.issue_archive_dir + "contents.json", mode="w") as fp:
                json.dump(self.contents, fp)
        except EnvironmentError:
            raise ScraperError("Unable to write the contents.json file.")

        self.removeLockfile()

    def set_issue_date(self):
        """
        Works out what date's paper we're getting.
        Sets self.issue_date and self.paper_name.
        """
        self.issue_date = datetime.datetime.now(pytz.timezone("Europe/London"))

        if self.issue_date.weekday() == 6:
            self.paper_name = self.contents["meta"]["paper_name"] = "observer"
        else:
            self.paper_name = self.contents["meta"]["paper_name"] = "guardian"

        return True

    def scrape_print_date(self, soup):
        """
        Given a Beautiful Soup object of the page of a Guardian/Observer issue
        contents this will extract the date of the issue from the page and return a
        datetime object.
        """
        # Get the string of the date, eg "Monday 14 December 2015".
        today_str = soup.find(
            "div", {"class": "fc-container__header__description"}
        ).string

        return dateutil.parser.parse(today_str)

    def paper_url(self, paper_date):
        """
        Given a datetime object it will return the URL of the Observer (on Sundays)
        or the Guardian (any other day).
        """
        if paper_date.weekday() == 6:
            return self.source_urls["observer"]  # Sunday
        else:
            return self.source_urls["guardian"]  # Monday to Saturday

    def fetch_articles(self, page=1):
        """
        Fetches all of the contents of the articles from the API and saves the
        HTMLised version to disk.
        """

        max_articles_to_fetch = 200

        fetched_articles = self.fetch_page_of_articles(
            page=page, page_size=max_articles_to_fetch
        )

        if fetched_articles is False:
            raise ScraperError("Error when fetching data from API.")

        for article in fetched_articles:
            # We'll put any tags we want to keep in article itself:
            tags = article["tags"]
            del article["tags"]

            if len(tags) == 0:
                self.message(
                    "* %s has no tags; unable to put into section." % article["id"]
                )
                continue

            if "newspaperPageNumber" not in article["fields"]:
                self.message(
                    "* %s has no page number; unable to put into section."
                    % article["id"]
                )
                continue

            # Just get the dicts for book and book_section out of the tags list.
            book = next((tag for tag in tags if tag["type"] == "newspaper-book"), None)
            book_section = next(
                (tag for tag in tags if tag["type"] == "newspaper-book-section"), None
            )
            # There might be more than contributor; we're only using one:
            contributor = next(
                (tag for tag in tags if tag["type"] == "contributor"), None
            )

            if book is None:
                self.message(
                    "* %s has no 'book' tag; unable to put into section."
                    % article["id"]
                )
                continue

            # Save these in easy to get places for the template:
            article["newspaperBook"] = book
            article["newspaperBookSection"] = book_section
            article["contributor"] = contributor

            article["tone"] = self.get_tone(tags)

            if book["id"] not in self.fetched_books:
                self.fetched_books[book["id"]] = {
                    "meta": book,
                    "articles": [],
                }

            # Make page number into an int.
            article["fields"]["newspaperPageNumber"] = int(
                article["fields"]["newspaperPageNumber"]
            )

            # Make wordcount int, and increase issue's max wordcount if appropriate.
            article["fields"]["wordcount"] = int(article["fields"]["wordcount"])
            words = article["fields"]["wordcount"]
            if words > self.contents["meta"]["max_words"]:
                self.contents["meta"]["max_words"] = words

            # Save file and store its filename:
            article["file"] = self.save_article_html(article)

            self.fetched_books[book["id"]]["articles"].append(article)

        if len(fetched_articles) >= max_articles_to_fetch:
            # We fetched the maximum, so there might be another page.
            # Call this same method again:
            # Pause, be nice.
            time.sleep(1)
            self.fetch_articles(page=page + 1)

    def sort_articles(self):
        """Puts data from self.fetched_books in the correct order and format,
        and puts them into the self.content['books'] list.
        self.fetched_books is like:
            {
                'theguardian/mainsection': {
                    'meta': {...},
                    'articles': [...],
                },
                'theguardian/sport': {
                    ...
                },
                ...
            }

        So, we need to take the value dicts out of there and put them in
        self.content['books'] in the correct order.
        And sort the articles in each section by page number.
        """

        # The initial known books of each day's newspaper, in order:
        start_orders = {
            "weekday": ["theguardian/mainsection", "theguardian/g2"],
            "saturday": [
                "theguardian/mainsection",
                "theguardian/theguide",
                "theguardian/guardianreview",
                "theguardian/weekend",
                "theguardian/travel",
                "theguardian/cook",
                "theguardian/family",
            ],
            "sunday": [
                "theobserver/news",
                "theobserver/review",
                "theobserver/magazine",
            ],
        }

        # Get today's initial books, and also the sport section.
        if self.paper_name == "observer":
            start_order = start_orders["sunday"]
            sport_id = "theobserver/sport"

        elif self.issue_date.weekday() == 5:
            start_order = start_orders["saturday"]
            sport_id = "theguardian/sport"

        else:
            start_order = start_orders["weekday"]
            sport_id = "theguardian/sport"

        # We'll put the initial books in `start`.
        # And the sport book in `end`.
        # And any others - new books or special one-offs - in `middle`.
        start = []
        middle = []
        end = []

        for book in start_order:
            if book in self.fetched_books:
                start.append(self.fetched_books.pop(book))

        if sport_id in self.fetched_books:
            end.append(self.fetched_books.pop(sport_id))

        for book, bookdata in self.fetched_books.items():
            middle.append(bookdata)

        # Put all the books together in the correct order.
        # self.contents['books'] is now a list of dicts, one dict per book.
        # Each book dict has 'meta' and 'articles' keys.
        self.contents["books"] = start + middle + end

        # Sort the articles within each book:
        for book in self.contents["books"]:
            book["articles"] = sorted(
                book["articles"], key=lambda k: k["fields"]["newspaperPageNumber"]
            )

    def fetch_page_of_articles(self, page=1, page_size=200):
        """Fetches a single set of articles from today's issue.
        Returns a list of dicts, each dict an article's data.
        Or False if there was an error.
        """

        api_url = "http://content.guardianapis.com/search"

        url_args = {
            "page": page,
            "page-size": page_size,
            "api-key": self.guardian_api_key,
            "format": "json",
            "show-fields": (
                "body,byline,headline,newspaperPageNumber,publication,shortUrl,"
                "standfirst,thumbnail,wordcount"
            ),
            "show-elements": "all",
            "show-tags": "contributor,newspaper-book,newspaper-book-section,tone",
            # Get the articles from today's edition:
            "use-date": "newspaper-edition",
            "from-date": self.issue_date.strftime("%Y-%m-%d"),
            "to-date": self.issue_date.strftime("%Y-%m-%d"),
            # The most we can fetch per page:
        }

        self.message("Fetching page %s of up to %s articles." % (page, page_size))

        error_message = ""
        response = None

        try:
            response = requests.get(api_url, params=url_args, timeout=20)
            response.raise_for_status()
        except requests.exceptions.HTTPError:
            error_message = "HTTP Error: %s" % response.status_code
        except requests.exceptions.ConnectionError as e:
            error_message = "Can't connect to domain: %s" % e
        except requests.exceptions.ConnectTimeout as e:
            error_message = "Connection timed out: %s" % e
        except requests.exceptions.ReadTimeout as e:
            error_message = "Read timed out: %s" % e
        except requests.exceptions.RequestException as e:
            # Catches any other requests exceptions.
            error_message = "RequestException: %s" % e

        if error_message == "":
            # All good so far. Check the returned data.
            data = response.json()
            if (
                "response" in data
                and "status" in data["response"]
                and "results" in data["response"]
            ):
                if data["response"]["status"] != "ok":
                    error_message = (
                        "The API returned the status '%s'" % data["response"]["ok"]
                    )
            else:
                error_message = "The returned data was not the expected format."

        if error_message == "":
            # Still OK!
            articles = data["response"]["results"]
            self.message("Fetched %s articles." % len(articles))
            return articles
        else:
            self.message("ERROR: %s" % error_message)
            return False

    def get_tone(self, tags):
        """Look through all the tags (a list of dicts) we've got for an article
        and using the 0 or more of type 'tag', assign one tone that will be
        used to give the article a color.
        We use these tones and ignore the others:
        https://github.com/guardian/frontend/tree/master/static/src/stylesheets/module/content/tones
        """
        tones_to_use = [
            "analysis",
            "comment",
            "dead",
            "editorial",
            "feature",
            "letters",
            "live",
            "media",
            "news",
            "obituaries",
            "review",
            "special-report",
        ]

        for tag in tags:
            if tag["type"] == "tone":
                # tag['id'] is like "tone/features"
                tone = tag["id"].split("/")[1]
                if tone in tones_to_use:
                    return tone

        return "default"

    def save_article_html(self, article):
        """Makes the HTML for the article and saves it to a file.
        article is all the article's data from the API.
        Returns the filename.
        """
        html = self.make_article_html(article)

        # There was once an article ID that was 300 characters long, and the maximum
        # filename length is 255. So we gave up on saving the files with nice readable
        # names and instead make a hash of the ID and use that.
        filename_hash = hashlib.md5(article["id"].encode('utf-8')).hexdigest()
        filename = "%s.%s" % (filename_hash, "html")

        try:
            article_file = open(self.issue_archive_dir + filename, "w")
            try:
                article_file.write(html)
            finally:
                article_file.close()
        except IOError:
            raise ScraperError(
                "IOError when writing " + self.issue_archive_dir + filename
            )

        return filename

    def make_article_html(self, article):
        """
        Takes the dictionary for an article from the API and returns an HTML
        version of it.
        """
        return self.template.render(article=article)

        # TODO: Add colours.
        # if 'sectionId' in content and content['sectionId'] in self.section_ids:
        # html = "<div class=\"section-"+self.section_ids[content['sectionId']]+"\">\n"
        # else:
        # html = "<div class=\"section-default\">\n"

    def fetch_page(self, url):
        "Used for fetching all the remote pages."

        self.message("Fetching: " + url)

        try:
            response = requests.get(url, timeout=10)
        except requests.exceptions.ConnectionError:
            self.message("Can't connect to domain.")
        except requests.exceptions.ConnectTimeout:
            self.message("Connection timed out.")
        except requests.exceptions.ReadTimeout:
            self.message("Read timed out.")

        try:
            response.raise_for_status()
        except requests.exceptions.HTTPError:
            self.message("HTTP Error: %s" % response.status_code)

        return response.text

    def message(self, text):
        "Output debugging info, if in verbose mode."
        if self.verbose:
            print(text)


class ScraperError(Exception):
    pass


def main():
    scraper = GuardianGrabber()

    scraper.start()


if __name__ == "__main__":
    main()
