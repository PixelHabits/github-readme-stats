// @ts-check
import { retryer } from "../common/retryer.js";
import {
	CustomError,
  logger,
  MissingParamError,
	request,
	wrapTextMultiline,
} from "../common/utils.js";

/**
 * @typedef {import("axios").AxiosRequestHeaders} AxiosRequestHeaders Axios request headers.
 * @typedef {import("axios").AxiosResponse} AxiosResponse Axios response.
 */

/**
 * Top languages fetcher object.
 *
 * @param {AxiosRequestHeaders} variables Fetcher variables.
 * @param {string} token GitHub token.
 * @returns {Promise<AxiosResponse>} Languages fetcher response.
 */
const fetcher = (variables, token) => {
	return request(
		{
			query: `
      query userInfo($login: String!, $after: String) {
        user(login: $login) {
          # fetch only owner repos & not forks
          repositories(
            ownerAffiliations: OWNER, 
            isFork: false, 
            first: 100, 
            after: $after
          ) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              name
              languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
                edges {
                  size
                  node {
                    color
                    name
                  }
                }
              }
            }
          }
        }
      }
      `,
			variables,
		},
		{
			Authorization: `token ${token}`,
		},
	);
};

/**
 * @typedef {import("./types").TopLangData} TopLangData Top languages data.
 */

/**
 * Fetch top languages for a given username.
 *
 * @param {string} username GitHub username.
 * @param {string[]} exclude_repo List of repositories to exclude.
 * @param {number} size_weight Weightage to be given to size.
 * @param {number} count_weight Weightage to be given to count.
 * @returns {Promise<TopLangData>} Top languages data.
 */
const fetchTopLanguages = async (
	username,
	exclude_repo = [],
	size_weight = 1,
	count_weight = 0,
) => {
	if (!username) {
		throw new MissingParamError(["username"]);
	}

	let hasNextPage = true;
	let after = null;
	let repoNodes = [];

	while (hasNextPage) {
		const res = await retryer(fetcher, { login: username, after: after });

		if (res.data.errors) {
			logger.error(res.data.errors);
			if (res.data.errors[0].type === "NOT_FOUND") {
				throw new CustomError(
					res.data.errors[0].message || "Could not fetch user.",
					CustomError.USER_NOT_FOUND,
				);
			}
			if (res.data.errors[0].message) {
				throw new CustomError(
					wrapTextMultiline(res.data.errors[0].message, 90, 1)[0],
					res.statusText,
				);
			}
			throw new CustomError(
				"Something went wrong while trying to retrieve the language data using the GraphQL API.",
				CustomError.GRAPHQL_ERROR,
			);
		}

		const repositories = res.data.data.user.repositories;
		repoNodes = repoNodes.concat(repositories.nodes);
		hasNextPage = repositories.pageInfo.hasNextPage;
		after = repositories.pageInfo.endCursor;
	}

	const repoToHide = {};

	if (exclude_repo) {
		exclude_repo.forEach((repoName) => {
			repoToHide[repoName] = true;
		});
	}

	// Filter out repositories to be hidden
	repoNodes = repoNodes.filter((repo) => !repoToHide[repo.name]);

	const languageData = {};

	// Aggregate language data across all repositories
	repoNodes
		.filter((node) => node.languages.edges.length > 0)
		.forEach((repo) => {
			repo.languages.edges.forEach((edge) => {
				const langName = edge.node.name;
				const langColor = edge.node.color;
				const langSize = edge.size;

				if (languageData[langName]) {
					languageData[langName].size += langSize;
					languageData[langName].count += 1;
				} else {
					languageData[langName] = {
						name: langName,
						color: langColor,
						size: langSize,
						count: 1,
					};
				}
			});
		});

	// Adjust language size based on weights
	Object.keys(languageData).forEach((name) => {
		languageData[name].size =
			Math.pow(languageData[name].size, size_weight) *
			Math.pow(languageData[name].count, count_weight);
	});

	// Sort languages by size
	const topLangs = Object.keys(languageData)
		.sort((a, b) => languageData[b].size - languageData[a].size)
		.reduce((result, key) => {
			result[key] = languageData[key];
			return result;
		}, {});

	return topLangs;
};

export { fetchTopLanguages };
export default fetchTopLanguages;
